import argparse
import html
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    from lxml import html as lxml_html
except Exception:  # pragma: no cover - local generation can fall back to regex cleanup.
    lxml_html = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"


KIND_LABELS = {
    "overview": "Lesson Expectations",
    "lesson": "Lesson",
    "handsOn": "Hands On",
    "hands_on": "Hands On",
    "consolidation": "Consolidation",
    "homework": "Homework",
}

DEFAULT_FIVE_PAGE_LABELS = {
    1: "Lesson Expectations",
    2: "Lesson",
    3: "Hands On",
    4: "Consolidation",
    5: "Homework",
}

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
VIDEO_PLUGIN_PATTERN = re.compile(
    r'<div class="mediaplugin\s+mediaplugin_videojs\b[\s\S]*?&nbsp;<br><p></p>',
    re.IGNORECASE,
)
CSS_URL_PATTERN = re.compile(r'url\(\s*["\']?(?:https?:)?//[^)"\']+["\']?\s*\)', re.IGNORECASE)


def load_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def slug(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return text or "section"


def url_basename(value: str) -> str:
    parsed = urlparse(value)
    nested = parse_qs(parsed.query).get("url", [""])[0]
    if nested:
        return url_basename(unquote(nested))
    return unquote(Path(parsed.path).name).lower()


def relative_course_href(from_dir: Path, course_root: Path, resource_path: str) -> str:
    target = (course_root / resource_path).resolve()
    return os.path.relpath(target, from_dir).replace("\\", "/")


def section_label(page: dict, index: int) -> str:
    kind = str(page.get("kind") or "")
    if kind in KIND_LABELS:
        return KIND_LABELS[kind]
    headings = page.get("heading") or []
    if len(headings) > 1:
        label = normalize_section_label(str(headings[1]))
        if label:
            return label
    html_text = str(page.get("html") or "")
    label = infer_section_label_from_html(html_text)
    if label:
        return label
    if index in DEFAULT_FIVE_PAGE_LABELS:
        return DEFAULT_FIVE_PAGE_LABELS[index]
    return f"Section {index}"


def section_title(page: dict, fallback: str) -> str:
    def clean_title(value: str) -> str:
        text = re.sub(r"\s+", " ", html.unescape(value)).strip()
        if re.search(r"https?://|pluginfile\.php|mod_book/chapter", text, flags=re.I):
            return ""
        return text

    headings = [str(item) for item in page.get("heading") or [] if str(item).strip()]
    if len(headings) > 2:
        return clean_title(headings[2]) or fallback
    if len(headings) > 1:
        return clean_title(headings[1]) or fallback
    return fallback


def normalize_section_label(value: str) -> str:
    text = re.sub(r"\s+", " ", html.unescape(value)).strip()
    lower = text.lower()
    if not text or re.fullmatch(r"section\s+\d+", lower):
        return ""
    if re.fullmatch(r"lesson\s+\d+\s*:.*", lower):
        return ""
    if "expectation" in lower or lower in {"overview", "introduction"}:
        return "Lesson Expectations"
    if "hands" in lower:
        return "Hands On"
    if "consolidation" in lower:
        return "Consolidation"
    if "homework" in lower:
        return "Homework"
    if lower == "lesson":
        return "Lesson"
    return text


def infer_section_label_from_html(html_text: str) -> str:
    for match in re.finditer(r"<h[1-6]\b[^>]*>(.*?)</h[1-6]>", html_text, re.IGNORECASE | re.DOTALL):
        text = re.sub(r"<[^>]+>", " ", match.group(1))
        label = normalize_section_label(text)
        if label:
            return label
    return ""


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
        names = {Path(path).name.lower()}
        source = resource.get("source") or resource.get("url") or ""
        if source:
            mapped.setdefault(str(source), path)
            mapped.setdefault(str(source).replace("&", "&amp;"), path)
            source_name = url_basename(str(source))
            if source_name:
                names.add(source_name)
        label_name = Path(str(resource.get("label") or "")).name.lower()
        if "." in label_name:
            names.add(label_name)
            if " - " in label_name:
                names.add(label_name.rsplit(" - ", 1)[1])
        for name in names:
            mapped.setdefault(name, path)
    return mapped


def local_path_for_url(value: str, resource_map: dict[str, str]) -> str | None:
    if value in resource_map:
        return resource_map[value]
    html_unescaped = html.unescape(value)
    if html_unescaped in resource_map:
        return resource_map[html_unescaped]
    name = url_basename(value)
    if name and name in resource_map:
        return resource_map[name]
    return None


def local_h5p_embed_for_path(local_path: str, output_dir: Path, course_root: Path, title: str = "Local H5P activity") -> str:
    href = relative_course_href(output_dir, course_root, local_path)
    escaped_title = html.escape(title)
    if str(local_path).lower().endswith("/index.html") or str(local_path).lower().endswith("\\index.html"):
        return (
            '<div class="embedded-h5p">'
            f'<iframe src="{html.escape(href + "?embed=1", quote=True)}" title="{escaped_title}" '
            'loading="lazy" allowfullscreen="allowfullscreen"></iframe>'
            "</div>"
        )
    return sanitized_notice(f"Embedded activity is available as a local resource: {Path(local_path).name}")


def sanitized_notice(label: str) -> str:
    return f'<div class="localized-resource-note">{html.escape(label)}</div>'


def is_ispring_url(value: str) -> bool:
    text = value.lower()
    return "ispring" in text or "hexstruct.ispring.com" in text


def local_ispring_embed(lesson: dict, output_dir: Path, course_root: Path, section_label_value: str) -> str:
    candidates = []
    for item in lesson.get("ispring") or []:
        path = item.get("path")
        url = item.get("url")
        if not path and not url:
            continue
        if ispring_section_label(item) == section_label_value:
            candidates.append(item)
    if not candidates:
        return ""

    for item in candidates:
        path = item.get("path")
        href = relative_course_href(output_dir, course_root, path) if path else str(item.get("url") or "")
        if not href:
            continue
        title = html.escape(str(item.get("label") or lesson.get("title") or "iSpring lesson"))
        return (
            '<div class="embedded-ispring">'
            f'<iframe src="{html.escape(href, quote=True)}" title="{title}" '
            'loading="lazy" allowfullscreen="allowfullscreen"></iframe>'
            "</div>"
        )
    return ""


def ispring_section_label(item: dict) -> str:
    value = f"{item.get('label') or ''} {item.get('path') or ''} {item.get('url') or ''}".lower()
    if "consolidation" in value:
        return "Consolidation"
    if "homework" in value:
        return "Homework"
    if "hands" in value:
        return "Hands On"
    return "Lesson"


def local_h5p_embed(lesson: dict, output_dir: Path, course_root: Path, section_label_value: str) -> str:
    expected_roles = {
        "Hands On": {"handson", "hands_on"},
        "Consolidation": {"consolidation"},
    }.get(section_label_value, set())
    if not expected_roles:
        return ""

    def score(item: dict) -> tuple[int, int, int]:
        preview = str(item.get("previewPath") or "")
        path = str(item.get("path") or "")
        return (
            1 if preview and not preview.startswith("previews-html/") else 0,
            1 if "/downloaded_resources/" in path else 0,
            0 if "-2." in path else 1,
        )

    candidates = []
    for item in lesson.get("downloads") or []:
        role = str(item.get("role") or "").lower()
        if item.get("type") != "h5p" or (role not in expected_roles and role != "lesson_h5p_package"):
            continue
        preview_path = item.get("previewPath")
        download_path = item.get("path")
        if not preview_path or not download_path:
            continue
        candidates.append(item)

    for item in sorted(candidates, key=score, reverse=True):
        preview_path = item.get("previewPath")
        download_path = item.get("path")
        preview_href = relative_course_href(output_dir, course_root, preview_path)
        raw_title = str(item.get("label") or "")
        if not raw_title or raw_title.lower().endswith(".h5p"):
            raw_title = f"{section_label_value} H5P Quiz" if section_label_value == "Hands On" else f"{section_label_value} H5P Activity"
        title = html.escape(raw_title)
        embed_href = f"{preview_href}?embed=1"
        return (
            '<div class="embedded-h5p">'
            f'<iframe src="{html.escape(embed_href, quote=True)}" title="{title}" '
            'loading="lazy" allowfullscreen="allowfullscreen"></iframe>'
            "</div>"
        )
    return ""


def local_video_embed(lesson: dict, output_dir: Path, course_root: Path, section_label_value: str) -> str:
    if section_label_value != "Consolidation":
        return ""

    candidates_by_name: dict[str, dict] = {}
    for item in lesson.get("downloads") or []:
        role = str(item.get("role") or "").lower()
        path = str(item.get("path") or "")
        if item.get("type") != "mp4" or role not in {"consolidation", "lesson_video"} or not path:
            continue
        key = normalized_video_name(path)
        current = candidates_by_name.get(key)
        if current is None or video_score(item) > video_score(current):
            candidates_by_name[key] = item
    if not candidates_by_name:
        return ""

    parts = []
    for item in sorted(candidates_by_name.values(), key=lambda candidate: natural_sort_key(str(candidate.get("label") or candidate.get("path") or ""))):
        href = relative_course_href(output_dir, course_root, str(item["path"]))
        title = html.escape(str(item.get("label") or "Summary Video"))
        parts.append(
            '<div class="embedded-video">'
            f'<video controls preload="metadata" src="{html.escape(href, quote=True)}"></video>'
            "</div>"
            '<div class="embedded-resource-card">'
            f"<strong>{title}</strong>"
            "<span>Local video file.</span>"
            "</div>"
        )
    return "".join(parts)


def missing_video_notice(body: str, section_label_value: str) -> str:
    return ""


def normalized_video_name(path: str) -> str:
    name = Path(path).name.lower()
    return re.sub(r"-2(?=\.mp4$)", "", name)


def video_score(item: dict) -> tuple[int, int]:
    path = str(item.get("path") or "")
    return (1 if "/downloaded_resources/" in path else 0, 0 if "-2." in path else 1)


def natural_sort_key(value: str) -> list[int | str]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


def is_h5p_url(value: str) -> bool:
    text = value.lower()
    return "h5p_embed" in text or "/h5p/embed.php" in text or text.endswith(".h5p")


def is_quizlet_url(value: str) -> bool:
    return "quizlet.com/" in value.lower()


def sanitize_body(
    body: str,
    output_dir: Path,
    course_root: Path,
    resource_map: dict[str, str],
    section_label_value: str = "",
    ispring_embed: str = "",
    h5p_embed: str = "",
    video_embed: str = "",
) -> str:
    def replace_iframe(match: re.Match[str]) -> str:
        source_match = re.search(r'\bsrc\s*=\s*["\']([^"\']+)["\']', match.group(0), re.IGNORECASE)
        if source_match:
            local_path = local_path_for_url(source_match.group(1), resource_map)
            if ispring_embed and is_ispring_url(source_match.group(1)):
                return ispring_embed
            if local_path and is_h5p_url(source_match.group(1)):
                return local_h5p_embed_for_path(local_path, output_dir, course_root)
            if h5p_embed and is_h5p_url(source_match.group(1)):
                return h5p_embed
            if local_path:
                return sanitized_notice(f"Embedded activity is available as a local resource: {Path(local_path).name}")
            if is_quizlet_url(source_match.group(1)):
                return sanitized_notice("External Quizlet activity omitted from the local teacher resource view.")
        if source_match and is_h5p_url(source_match.group(1)):
            return sanitized_notice("Student submission activity omitted from the teacher resource view.")
        return sanitized_notice("Embedded activity is listed as a local lesson resource in the portal.")

    def replace_attr(match: re.Match[str]) -> str:
        attr = match.group("attr").lower()
        quote = match.group("quote")
        url = match.group("url")
        if attr == "src" and is_ispring_url(url):
            return f'{attr}={quote}{html.escape(url, quote=True)}{quote}'
        local_path = local_path_for_url(url, resource_map)
        if local_path:
            href = relative_course_href(output_dir, course_root, local_path)
            return f'{attr}={quote}{html.escape(href, quote=True)}{quote}'
        if attr == "href":
            return 'data-localized-link="removed"'
        return f'data-localized-{attr}="removed"'

    cleaned = EXTERNAL_SCRIPT_PATTERN.sub("", body)
    if video_embed:
        cleaned = strip_moodle_video_players(cleaned)
        cleaned = insert_video_embed(cleaned, video_embed)
    else:
        video_notice = missing_video_notice(cleaned, section_label_value)
        if video_notice:
            cleaned = strip_moodle_video_players(cleaned)
            cleaned = insert_video_embed(cleaned, video_notice)
    cleaned = IFRAME_PATTERN.sub(replace_iframe, cleaned)
    cleaned = CSS_URL_PATTERN.sub("url('')", cleaned)
    cleaned = EXTERNAL_ATTR_PATTERN.sub(replace_attr, cleaned)
    cleaned = EXTERNAL_DATA_SOURCE_PATTERN.sub("", cleaned)
    cleaned = re.sub(r'<a\b[^>]*title=["\']Edit H5P content["\'][^>]*>.*?</a>', "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r">https?://[^<]+<", ">Local resource<", cleaned)
    cleaned = re.sub(r'<a\b[^>]*\bdata-localized-link=["\']removed["\'][^>]*>\s*</a>', "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r'<a\b([^>]*)\bdata-localized-link=["\']removed["\']([^>]*)>(.*?)</a>', r"<span\1\2>\3</span>", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<p>\s*(<div class=\"embedded-ispring\">.*?</div>)\s*</p>", r"\1", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"<p>\s*(<div class=\"embedded-h5p\">.*?</div>)\s*</p>", r"\1", cleaned, flags=re.DOTALL)
    return cleaned


def strip_moodle_video_players(body: str) -> str:
    if lxml_html is None:
        return VIDEO_PLUGIN_PATTERN.sub("", body)
    try:
        root = lxml_html.fragment_fromstring(body, create_parent="div")
        for node in root.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " mediaplugin_videojs ")]'):
            parent = node.getparent()
            if parent is not None:
                parent.remove(node)
        return "".join(lxml_html.tostring(child, encoding="unicode", method="html") for child in root)
    except Exception:
        return VIDEO_PLUGIN_PATTERN.sub("", body)


def insert_video_embed(body: str, video_embed: str) -> str:
    pattern = re.compile(r"(<h[1-6]\b[^>]*>\s*Summary Video\s*</h[1-6]>\s*(?:<p\b[^>]*>\s*(?:&nbsp;|\s)*</p>\s*)*)", re.IGNORECASE)
    if pattern.search(body):
        return pattern.sub(lambda match: match.group(1) + video_embed, body, count=1)
    return video_embed + body


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
    .moodle-content img, .moodle-content video, .moodle-content iframe {{ max-width: 100%; }}
    .embedded-ispring {{ border: 1px solid #b7cbe5; border-radius: 8px; background: #f8fbff; margin: 16px 0; overflow: hidden; aspect-ratio: 16 / 9; }}
    .embedded-ispring iframe {{ border: 0; display: block; height: 100%; width: 100%; }}
    .embedded-video {{ border: 1px solid #b7cbe5; border-radius: 8px; background: #000; margin: 16px 0; overflow: hidden; }}
    .embedded-video video {{ display: block; width: 100%; }}
    .embedded-h5p {{ border: 1px solid #b7cbe5; border-radius: 8px; background: #fff; margin: 16px 0; overflow: hidden; min-height: 240px; }}
    .embedded-h5p iframe {{ border: 0; display: block; height: 240px; min-height: 240px; width: 100%; }}
    .embedded-resource-card {{ border: 1px solid #9bb8d9; border-radius: 8px; background: #f2f7fc; color: #102f4e; margin: 12px 0; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }}
    .embedded-resource-card strong, .embedded-resource-card span {{ flex-basis: 100%; }}
    .embedded-resource-card a {{ width: fit-content; border: 1px solid #7da2cd; border-radius: 6px; padding: 7px 10px; background: #fff; font-weight: 700; }}
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
  <script>
    window.addEventListener("message", function (event) {{
      if (!event.data || event.data.type !== "ossd:h5p-height") return;
      var iframes = document.querySelectorAll(".embedded-h5p iframe");
      iframes.forEach(function (iframe) {{
        if (event.source === iframe.contentWindow) {{
          iframe.style.height = Math.max(Number(event.data.height) || 0, 240) + "px";
        }}
      }});
    }});
  </script>
</body>
</html>
"""


def build_sections(course: str, unit_number: int | None = None) -> dict:
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
            lesson_path = lesson.get("path")
            if not lesson_path:
                continue
            raw_path = course_root / lesson_path / "book_pages_raw.json"
            if not raw_path.exists():
                continue
            pages = load_json(raw_path)
            if not isinstance(pages, list) or not pages:
                continue
            section_records = []
            resources_by_name = local_resource_map(lesson)
            book_dir = course_root / lesson_path / "book_sections"
            if book_dir.exists():
                resolved_book_dir = book_dir.resolve()
                if str(resolved_book_dir).startswith(str(course_root)):
                    for old_file in resolved_book_dir.glob("*.html"):
                        old_file.unlink()
            for index, page in enumerate(pages, start=1):
                label = section_label(page, index)
                title = section_title(page, label)
                rel_path = f"{lesson_path}/book_sections/{index:02d}-{slug(label)}.html"
                output_path = course_root / rel_path
                output_path.parent.mkdir(parents=True, exist_ok=True)
                ispring_embed = local_ispring_embed(lesson, output_path.parent, course_root, label)
                h5p_embed = local_h5p_embed(lesson, output_path.parent, course_root, label)
                video_embed = local_video_embed(lesson, output_path.parent, course_root, label)
                body = sanitize_body(
                    str(page.get("html") or ""),
                    output_path.parent,
                    course_root,
                    resources_by_name,
                    label,
                    ispring_embed,
                    h5p_embed,
                    video_embed,
                )
                output_path.write_text(
                    standalone_section_html(course, int(unit["unit"]), int(lesson["lesson"]), str(lesson["title"]), index, label, title, body),
                    encoding="utf-8",
                )
                section_records.append(
                    {
                        "label": f"{label} - {lesson['title']}",
                        "sectionLabel": label,
                        "sectionIndex": index,
                        "type": "html",
                        "category": "moodle_book_section",
                        "role": "lesson_book_section",
                        "path": rel_path.replace("\\", "/"),
                        "bytes": output_path.stat().st_size,
                        "source": str(page.get("url", "")),
                    },
                )
            lesson["bookSections"] = section_records
            lesson["bookPageCount"] = len(section_records)
            lesson["resourceCounts"] = lesson.get("resourceCounts") or {}
            lesson["resourceCounts"]["bookSections"] = len(section_records)
            result["lessons"].append({"lesson": lesson["id"], "sections": len(section_records)})

    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, manifest)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course", required=True)
    parser.add_argument("--unit", type=int)
    args = parser.parse_args()
    print(json.dumps(build_sections(args.course, args.unit), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
