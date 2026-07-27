from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from lxml import html as lxml_html


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"

STANDARD_LABELS = {
    1: "Lesson Expectations",
    2: "Lesson",
    3: "Hands On",
    4: "Consolidation",
    5: "Homework",
}

ACTIVITY_PLACEHOLDER = "Embedded activity is listed as a local lesson resource in the portal."
MISSING_ACTIVITY_NOTICE = "Embedded Moodle activity omitted: no local playable package is available yet."
MISSING_VIDEO_NOTICE = "Moodle video player omitted: no local video file is available yet."
NOTE_CSS = (
    ".localized-resource-note { border: 1px solid #b7cbe5; border-radius: 6px; "
    "background: #f2f7fc; color: #264461; margin: 12px 0; padding: 10px 12px; }"
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def safe_course_root(course: str) -> Path:
    course_root = (COURSEWARE_ROOT / course.upper()).resolve()
    if not str(course_root).startswith(str(COURSEWARE_ROOT.resolve())):
        raise RuntimeError("Course path safety check failed")
    return course_root


def note_node(text: str):
    node = lxml_html.Element("div")
    node.set("class", "localized-resource-note")
    node.text = text
    return node


def replace_node(node, replacement) -> None:
    parent = node.getparent()
    if parent is None:
        return
    index = parent.index(node)
    parent.remove(node)
    parent.insert(index, replacement)


def ensure_note_css(document) -> None:
    styles = document.xpath("//style")
    if styles:
        text = styles[0].text or ""
        if ".localized-resource-note" not in text:
            styles[0].text = text.rstrip() + "\n    " + NOTE_CSS + "\n  "
        return

    head_nodes = document.xpath("//head")
    if not head_nodes:
        return
    style = lxml_html.Element("style")
    style.text = "\n    " + NOTE_CSS + "\n  "
    head_nodes[0].append(style)


def normalize_html(content: str, expected_label: str) -> str:
    try:
        document = lxml_html.fromstring(content)
    except Exception:
        return normalize_html_regex(content, expected_label)

    ensure_note_css(document)

    title = document.find(".//title")
    if title is not None and title.text:
        title.text = re.sub(r" - [^-<]+$", f" - {expected_label}", title.text)

    header = document.xpath('//section[contains(concat(" ", normalize-space(@class), " "), " moodle-section ")]/header[1]')
    if header:
        p_nodes = header[0].xpath("./p[1]")
        h2_nodes = header[0].xpath("./h2[1]")
        if p_nodes:
            p_nodes[0].text = expected_label
        if h2_nodes:
            h2_nodes[0].text = expected_label

    for node in document.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " localized-resource-note ")]'):
        text = "".join(node.itertext()).strip()
        if text == ACTIVITY_PLACEHOLDER:
            node.text = MISSING_ACTIVITY_NOTICE

    for node in document.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " mediaplugin_videojs ")]'):
        replace_node(node, note_node(MISSING_VIDEO_NOTICE))

    return lxml_html.tostring(document, encoding="unicode", method="html", doctype="<!doctype html>")


def normalize_html_regex(content: str, expected_label: str) -> str:
    content = re.sub(
        r"<header><p>.*?</p><h2>.*?</h2></header>",
        f"<header><p>{html.escape(expected_label)}</p><h2>{html.escape(expected_label)}</h2></header>",
        content,
        count=1,
        flags=re.IGNORECASE | re.DOTALL,
    )
    content = content.replace(ACTIVITY_PLACEHOLDER, MISSING_ACTIVITY_NOTICE)
    content = re.sub(
        r'<div class="mediaplugin\s+mediaplugin_videojs\b[\s\S]*?</div>',
        note_node(MISSING_VIDEO_NOTICE).text or MISSING_VIDEO_NOTICE,
        content,
        flags=re.IGNORECASE,
    )
    return content


def normalize_course(course: str) -> dict:
    course = course.upper()
    course_root = safe_course_root(course)
    manifest_path = course_root / "course-manifest.json"
    manifest = load_json(manifest_path)
    result = {
        "course": course,
        "lessonsWithSections": 0,
        "sectionsUpdated": 0,
        "lessonsWithoutSections": [],
    }

    for unit in manifest.get("units", []):
        for lesson in unit.get("lessons", []):
            sections = lesson.get("bookSections") or []
            if not sections:
                result["lessonsWithoutSections"].append(lesson.get("id"))
                continue
            result["lessonsWithSections"] += 1
            for section in sections:
                index = int(section.get("sectionIndex") or 0)
                expected = STANDARD_LABELS.get(index)
                if not expected:
                    continue
                section["sectionLabel"] = expected
                section["label"] = f"{expected} - {lesson.get('title')}"
                path_value = section.get("path")
                if not path_value:
                    continue
                html_path = course_root / path_value
                if not html_path.exists():
                    continue
                content = html_path.read_text(encoding="utf-8", errors="ignore")
                normalized = normalize_html(content, expected)
                if normalized != content:
                    html_path.write_text(normalized, encoding="utf-8")
                    section["bytes"] = html_path.stat().st_size
                    result["sectionsUpdated"] += 1
            lesson["bookPageCount"] = len(sections)
            lesson["resourceCounts"] = lesson.get("resourceCounts") or {}
            lesson["resourceCounts"]["bookSections"] = len(sections)

    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, manifest)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course", required=True)
    args = parser.parse_args()
    print(json.dumps(normalize_course(args.course), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
