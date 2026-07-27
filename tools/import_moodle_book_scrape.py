import argparse
import html
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"

EXTERNAL_ATTR_PATTERN = re.compile(
    r'\b(?P<attr>href|src|poster|action)\s*=\s*(?P<quote>["\'])(?P<url>(?:https?:)?//[^"\']+|/pluginfile\.php[^"\']*)(?P=quote)',
    re.IGNORECASE,
)
EXTERNAL_SCRIPT_PATTERN = re.compile(
    r'<script\b[^>]*\bsrc\s*=\s*["\'](?:https?:)?//[^"\']+["\'][^>]*>\s*</script>',
    re.IGNORECASE,
)
EXTERNAL_DATA_SOURCE_PATTERN = re.compile(
    r'\sdata-[\w-]*source\s*=\s*["\'](?:https?:)?//[^"\']+["\']',
    re.IGNORECASE,
)
IFRAME_PATTERN = re.compile(r"<iframe\b[^>]*>.*?</iframe>|<iframe\b[^>]*>", re.IGNORECASE | re.DOTALL)
CSS_URL_PATTERN = re.compile(r'url\(\s*["\']?(?:https?:)?//[^)"\']+["\']?\s*\)', re.IGNORECASE)


def strip_moodle_hrefs(fragment: str) -> str:
    if not fragment:
        return ""
    fragment = re.sub(
        r'href="(https://www\.esunnybrook\.com/[^"]*)"',
        r'data-moodle-source="\1"',
        fragment,
    )
    fragment = re.sub(
        r"href='(https://www\.esunnybrook\.com/[^']*)'",
        r"data-moodle-source='\1'",
        fragment,
    )
    return fragment


def url_basename(value: str) -> str:
    parsed = urlparse(value)
    nested = parse_qs(parsed.query).get("url", [""])[0]
    if nested:
        return url_basename(unquote(nested))
    return unquote(Path(parsed.path).name).lower()


def relative_course_href(from_dir: Path, course_root: Path, resource_path: str) -> str:
    target = (course_root / resource_path).resolve()
    return os.path.relpath(target, from_dir).replace("\\", "/")


def local_resource_map(lesson: dict) -> dict[str, str]:
    resources = []
    resources.extend(lesson.get("downloads") or [])
    resources.extend(lesson.get("textExports") or [])
    if lesson.get("lessonPlan"):
        resources.append(lesson["lessonPlan"])

    mapped: dict[str, str] = {}
    for resource in resources:
        path = resource.get("previewPath") or resource.get("path")
        if not path:
            continue
        mapped.setdefault(Path(path).name.lower(), path)
    return mapped


def local_path_for_url(value: str, resource_map: dict[str, str]) -> str | None:
    name = url_basename(value)
    if name and name in resource_map:
        return resource_map[name]
    return None


def sanitized_notice(label: str) -> str:
    return f'<div class="localized-resource-note">{html.escape(label)}</div>'


def sanitize_body(body: str, output_dir: Path, course_root: Path, resource_map: dict[str, str]) -> str:
    def replace_iframe(match: re.Match[str]) -> str:
        source_match = re.search(r'\bsrc\s*=\s*["\']([^"\']+)["\']', match.group(0), re.IGNORECASE)
        if source_match:
            local_path = local_path_for_url(source_match.group(1), resource_map)
            if local_path:
                return sanitized_notice(f"Embedded activity is available as a local resource: {Path(local_path).name}")
        return sanitized_notice("Embedded activity is listed as a local lesson resource in the portal.")

    def replace_attr(match: re.Match[str]) -> str:
        attr = match.group("attr").lower()
        quote = match.group("quote")
        url = match.group("url")
        local_path = local_path_for_url(url, resource_map)
        if local_path:
            href = relative_course_href(output_dir, course_root, local_path)
            return f'{attr}={quote}{html.escape(href, quote=True)}{quote}'
        if attr == "href":
            return 'data-localized-link="removed"'
        return f'data-localized-{attr}="removed"'

    cleaned = EXTERNAL_SCRIPT_PATTERN.sub("", body)
    cleaned = IFRAME_PATTERN.sub(replace_iframe, cleaned)
    cleaned = CSS_URL_PATTERN.sub("url('')", cleaned)
    cleaned = EXTERNAL_ATTR_PATTERN.sub(replace_attr, cleaned)
    cleaned = EXTERNAL_DATA_SOURCE_PATTERN.sub("", cleaned)
    cleaned = re.sub(r">https?://[^<]+<", ">Local resource<", cleaned)
    return cleaned


def find_active_moodle_refs(fragment: str) -> list[str]:
    if not fragment:
        return []
    refs: list[str] = []
    for match in re.finditer(
        r"""(?P<attr>\b(?:src|poster|action)\s*=\s*["'])(?P<url>https://www\.esunnybrook\.com/[^"']+|/pluginfile\.php[^"']*)""",
        fragment,
        flags=re.IGNORECASE,
    ):
        refs.append(f"{match.group('attr').split('=')[0].strip()}={match.group('url')}")
    for match in re.finditer(
        r"""url\(\s*["']?(?P<url>https://www\.esunnybrook\.com/[^)"']+|/pluginfile\.php[^)"']*)""",
        fragment,
        flags=re.IGNORECASE,
    ):
        refs.append(f"css-url={match.group('url')}")
    return refs


def assert_no_active_moodle_refs(course: str, unit: int, lesson_number: int, sections: list[dict]) -> None:
    findings: list[str] = []
    for section in sections:
        label = str(section.get("label", "section"))
        for ref in find_active_moodle_refs(str(section.get("html", ""))):
            findings.append(f"Lesson {lesson_number} {label}: {ref}")
    if findings:
        preview = "; ".join(findings[:6])
        extra = "" if len(findings) <= 6 else f"; +{len(findings) - 6} more"
        raise RuntimeError(
            f"{course} Unit {unit} has active Moodle media refs that must be localized before import: {preview}{extra}",
        )


def normalize_section_label(value: str) -> str:
    label = value.strip()
    if label.lower() in {"overview", "introduction"}:
        return "Lesson Expectations"
    return label


def standalone_html(course: str, unit: int, lesson_number: int, title: str, sections: list[dict]) -> str:
    section_html = []
    for section in sections:
        label = normalize_section_label(str(section.get("label", "")))
        section_html.append(
            f"""
    <section class="moodle-section">
      <header><p>{html.escape(label)}</p><h2>{html.escape(str(section.get("title", "")))}</h2></header>
      <div class="moodle-content">{strip_moodle_hrefs(str(section.get("html", "")))}</div>
    </section>""",
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{course} Unit {unit} Lesson {lesson_number} - {html.escape(title)}</title>
  <style>
    body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; color: #102033; background: #f6f8fb; line-height: 1.55; }}
    main {{ max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }}
    .page-title {{ border-bottom: 1px solid #d9e2ef; margin-bottom: 20px; padding-bottom: 16px; }}
    .page-title p {{ color: #586b85; margin: 0 0 6px; }}
    h1 {{ font-size: 28px; margin: 0; }}
    .moodle-section {{ background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; margin: 16px 0; padding: 20px; }}
    .moodle-section header {{ border-bottom: 1px solid #edf1f6; margin-bottom: 16px; padding-bottom: 12px; }}
    .moodle-section header p {{ color: #6b7c93; font-weight: 700; margin: 0 0 4px; text-transform: uppercase; }}
    .moodle-section header h2 {{ font-size: 20px; margin: 0; }}
    .moodle-content h3 {{ font-size: 18px; margin-top: 18px; }}
    .moodle-content table {{ border-collapse: collapse; max-width: 100%; }}
    .moodle-content td, .moodle-content th {{ border: 1px solid #d9e2ef; padding: 6px 8px; }}
    .moodle-content img {{ max-width: 100%; height: auto; }}
    .localized-resource-note {{ border: 1px solid #b7cbe5; border-radius: 6px; background: #f2f7fc; color: #264461; margin: 12px 0; padding: 10px 12px; }}
    a:not([href]) {{ color: inherit; text-decoration: none; }}
  </style>
</head>
<body>
  <main>
    <div class="page-title"><p>{course} · Unit {unit} · Lesson {lesson_number}</p><h1>{html.escape(title)}</h1></div>
{''.join(section_html)}
  </main>
</body>
</html>
"""


def standalone_section_html(
    course: str,
    unit: int,
    lesson_number: int,
    lesson_title: str,
    section_index: int,
    section: dict,
) -> str:
    label = normalize_section_label(str(section.get("label", "Section")))
    title = str(section.get("title", label))
    body = strip_moodle_hrefs(str(section.get("html", "")))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{course} Unit {unit} Lesson {lesson_number} - {html.escape(lesson_title)} - {html.escape(label)}</title>
  <style>
    body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; color: #102033; background: #f6f8fb; line-height: 1.55; }}
    main {{ max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }}
    .page-title {{ border-bottom: 1px solid #d9e2ef; margin-bottom: 20px; padding-bottom: 16px; }}
    .page-title p {{ color: #586b85; margin: 0 0 6px; }}
    h1 {{ font-size: 28px; margin: 0; }}
    .moodle-section {{ background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; margin: 16px 0; padding: 20px; }}
    .moodle-section header {{ border-bottom: 1px solid #edf1f6; margin-bottom: 16px; padding-bottom: 12px; }}
    .moodle-section header p {{ color: #6b7c93; font-weight: 700; margin: 0 0 4px; text-transform: uppercase; }}
    .moodle-section header h2 {{ font-size: 20px; margin: 0; }}
    .moodle-content h3 {{ font-size: 18px; margin-top: 18px; }}
    .moodle-content table {{ border-collapse: collapse; max-width: 100%; }}
    .moodle-content td, .moodle-content th {{ border: 1px solid #d9e2ef; padding: 6px 8px; }}
    .moodle-content img {{ max-width: 100%; height: auto; }}
  </style>
</head>
<body>
  <main>
    <div class="page-title"><p>{course} · Unit {unit} · Lesson {lesson_number} · Section {section_index}</p><h1>{html.escape(lesson_title)}</h1></div>
    <section class="moodle-section">
      <header><p>{html.escape(label)}</p><h2>{html.escape(title)}</h2></header>
      <div class="moodle-content">{body}</div>
    </section>
  </main>
</body>
</html>
"""


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def import_scrape(input_path: Path) -> dict:
    data = load_json(input_path)
    course = str(data["course"]).upper()
    unit_number = int(data["unit"])
    course_root = (COURSEWARE_ROOT / course).resolve()
    if not str(course_root).startswith(str(COURSEWARE_ROOT.resolve())):
        raise RuntimeError("Course path safety check failed")

    manifest_path = course_root / "course-manifest.json"
    manifest = load_json(manifest_path)
    unit = next((item for item in manifest.get("units", []) if int(item.get("unit", 0)) == unit_number), None)
    if not unit:
        raise RuntimeError(f"Unit {unit_number} not found in {manifest_path}")

    unit_dir = course_root / "moodle-html" / f"unit-{unit_number:02d}"
    unit_dir.mkdir(parents=True, exist_ok=True)

    written = []
    for index, lesson_data in enumerate(data.get("lessons", []), start=1):
        title = str(lesson_data.get("title") or f"Lesson {unit_number}.{index}")
        sections = lesson_data.get("sections") or []
        relative_path = f"moodle-html/unit-{unit_number:02d}/U{unit_number:02d}L{index:02d}.html"
        output_path = course_root / relative_path
        lesson = next(
            (entry for entry in unit.get("lessons", []) if int(entry.get("lesson", 0)) == index),
            {},
        )
        resources_by_name = local_resource_map(lesson)
        safe_sections = [
            {**section, "html": sanitize_body(str(section.get("html", "")), output_path.parent, course_root, resources_by_name)}
            for section in sections
        ]
        section_records = []
        section_dir = course_root / "moodle-html" / f"unit-{unit_number:02d}" / f"U{unit_number:02d}L{index:02d}"
        section_dir.mkdir(parents=True, exist_ok=True)
        output_path.write_text(standalone_html(course, unit_number, index, title, safe_sections), encoding="utf-8")
        for section_index, section in enumerate(safe_sections, start=1):
            section_relative_path = (
                f"moodle-html/unit-{unit_number:02d}/U{unit_number:02d}L{index:02d}/section-{section_index:02d}.html"
            )
            section_output_path = course_root / section_relative_path
            section_output_path.write_text(
                standalone_section_html(course, unit_number, index, title, section_index, section),
                encoding="utf-8",
            )
            section_records.append(
                {
                    "label": f"{normalize_section_label(str(section.get('label', f'Section {section_index}')))} - {title}",
                    "sectionLabel": normalize_section_label(str(section.get("label", f"Section {section_index}"))),
                    "sectionIndex": section_index,
                    "type": "html",
                    "category": "moodle_book_section",
                    "role": "lesson_book_section",
                    "path": section_relative_path,
                    "bytes": section_output_path.stat().st_size,
                    "source": str(section.get("url", "")),
                },
            )
        written.append(
            {
                "lessonNumber": index,
                "title": title,
                "relativePath": relative_path,
                "bytes": output_path.stat().st_size,
                "source": str(sections[0].get("url", "")) if sections else str(data.get("source", "")),
                "pageCount": len(sections),
                "sections": section_records,
            },
        )

    for item in written:
        lesson = next(
            (entry for entry in unit.get("lessons", []) if int(entry.get("lesson", 0)) == int(item["lessonNumber"])),
            None,
        )
        if not lesson:
            continue
        lesson["title"] = item["title"]
        lesson["bookPageCount"] = item["pageCount"]
        lesson["downloads"] = [
            resource
            for resource in lesson.get("downloads", [])
            if not (resource.get("category") == "moodle_book_copy" and resource.get("role") == "lesson_book")
        ]
        lesson["bookSections"] = item["sections"]
        lesson["resourceCounts"] = lesson.get("resourceCounts") or {}
        lesson["resourceCounts"]["downloads"] = len(lesson["downloads"])
        lesson["resourceCounts"]["bookSections"] = len(item["sections"])
        lesson["resourceCounts"]["lessonPlan"] = 1 if lesson.get("lessonPlan") else 0

    unit["summary"] = unit.get("summary") or {}
    unit["summary"]["downloads"] = sum(len(lesson.get("downloads", [])) for lesson in unit.get("lessons", []))
    manifest["sourceAudit"] = manifest.get("sourceAudit") or {}
    manifest["sourceAudit"]["moodleBookCopies"] = manifest["sourceAudit"].get("moodleBookCopies") or {}
    manifest["sourceAudit"]["moodleBookCopies"][f"unit{unit_number}"] = len(written)
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, manifest)

    return {"course": course, "unit": unit_number, "written": written}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    result = import_scrape(args.input.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
