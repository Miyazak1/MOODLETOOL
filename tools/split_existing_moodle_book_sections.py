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


SECTION_PATTERN = re.compile(
    r'<section class="moodle-section">\s*<header><p>(?P<label>.*?)</p><h2>(?P<title>.*?)</h2></header>\s*<div class="moodle-content">(?P<body>.*?)</div>\s*</section>',
    re.DOTALL | re.IGNORECASE,
)
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


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def strip_tags(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def normalize_section_label(value: str) -> str:
    label = value.strip()
    if label.lower() in {"overview", "introduction"}:
        return "Lesson Expectations"
    return label


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


def standalone_section_html(course: str, unit: int, lesson_number: int, lesson_title: str, section_index: int, label: str, title: str, body: str) -> str:
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
    .localized-resource-note {{ border: 1px solid #b7cbe5; border-radius: 6px; background: #f2f7fc; color: #264461; margin: 12px 0; padding: 10px 12px; }}
    a:not([href]) {{ color: inherit; text-decoration: none; }}
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


def split_sections(course: str, unit_number: int | None = None) -> dict:
    course = course.upper()
    course_root = (COURSEWARE_ROOT / course).resolve()
    if not str(course_root).startswith(str(COURSEWARE_ROOT.resolve())):
        raise RuntimeError("Course path safety check failed")

    manifest_path = course_root / "course-manifest.json"
    manifest = load_json(manifest_path)
    result = {"course": course, "lessons": []}

    for unit in manifest.get("units", []):
      if unit_number is not None and int(unit.get("unit", 0)) != unit_number:
          continue
      for lesson in unit.get("lessons", []):
          book = next(
              (
                  item
                  for item in lesson.get("downloads", [])
                  if item.get("category") == "moodle_book_copy" and item.get("role") == "lesson_book" and item.get("path")
              ),
              None,
          )
          if not book:
              continue

          source_path = course_root / book["path"]
          if not source_path.exists():
              continue
          source_html = source_path.read_text(encoding="utf-8")
          matches = list(SECTION_PATTERN.finditer(source_html))
          if not matches:
              continue

          unit_id = int(unit["unit"])
          lesson_number = int(lesson["lesson"])
          lesson_title = str(lesson["title"])
          section_records = []
          resources_by_name = local_resource_map(lesson)
          for section_index, match in enumerate(matches, start=1):
              label = normalize_section_label(strip_tags(match.group("label")) or f"Section {section_index}")
              title = strip_tags(match.group("title")) or label
              rel_path = f"moodle-html/unit-{unit_id:02d}/U{unit_id:02d}L{lesson_number:02d}/section-{section_index:02d}.html"
              output_path = course_root / rel_path
              output_path.parent.mkdir(parents=True, exist_ok=True)
              body = sanitize_body(match.group("body"), output_path.parent, course_root, resources_by_name)
              output_path.write_text(
                  standalone_section_html(course, unit_id, lesson_number, lesson_title, section_index, label, title, body),
                  encoding="utf-8",
              )
              section_records.append(
                  {
                      "label": f"{label} - {lesson_title}",
                      "sectionLabel": label,
                      "sectionIndex": section_index,
                      "type": "html",
                      "category": "moodle_book_section",
                      "role": "lesson_book_section",
                      "path": rel_path,
                      "bytes": output_path.stat().st_size,
                      "source": book.get("source", ""),
                  },
              )

          lesson["bookSections"] = section_records
          lesson["bookPageCount"] = len(section_records)
          lesson["downloads"] = [
              item
              for item in lesson.get("downloads", [])
              if not (item.get("category") == "moodle_book_copy" and item.get("role") == "lesson_book" and item.get("path") == book.get("path"))
          ]
          lesson["resourceCounts"] = lesson.get("resourceCounts") or {}
          lesson["resourceCounts"]["bookSections"] = len(section_records)
          lesson["resourceCounts"]["downloads"] = len(lesson["downloads"])
          result["lessons"].append({"lesson": lesson["id"], "sections": len(section_records)})

    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, manifest)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course", required=True)
    parser.add_argument("--unit", type=int)
    args = parser.parse_args()
    print(json.dumps(split_sections(args.course, args.unit), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
