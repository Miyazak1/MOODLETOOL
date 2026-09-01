from __future__ import annotations

import argparse
import html
import json
import re
import zipfile
from os.path import relpath
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

try:
    from PIL import Image
except Exception:  # noqa: BLE001
    Image = None


TEXT_NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def to_posix(value: str) -> str:
    return value.replace("\\", "/")


def sanitize_segment(value: str) -> str:
    value = to_posix(value).strip("/")
    return re.sub(r"[^A-Za-z0-9._/\- ]+", "_", value)


def iter_resource_items(manifest: dict[str, Any]):
    def walk_item(item: dict[str, Any]):
        yield item
        for attachment in item.get("attachments", []) or []:
            if isinstance(attachment, dict):
                yield from walk_item(attachment)

    def walk_unknown(value: Any):
        if isinstance(value, dict):
            if "label" in value:
                yield from walk_item(value)
            else:
                for nested in value.values():
                    yield from walk_unknown(nested)
        elif isinstance(value, list):
            for nested in value:
                yield from walk_unknown(nested)

    for item in manifest.get("courseDownloads", []):
        yield from walk_item(item)

    for item in manifest.get("teacherResources", []):
        yield from walk_item(item)

    for text in manifest.get("texts", []):
        for item in text.get("materials", []):
            yield from walk_item(item)

    for unit in manifest.get("units", []):
        unit_plan = unit.get("unitPlan")
        if unit_plan:
            yield from walk_item(unit_plan)

        yield from walk_unknown(unit.get("unitResources", {}))

        for lesson in unit.get("lessons", []):
            lesson_plan = lesson.get("lessonPlan")
            if lesson_plan:
                yield from walk_item(lesson_plan)

            for item in lesson.get("downloads", []):
                yield from walk_item(item)

            for item in lesson.get("textExports", []):
                yield from walk_item(item)


def slide_sort_key(path: str) -> tuple[int, str]:
    match = re.search(r"slide(\d+)\.xml$", path)
    return (int(match.group(1)) if match else 999999, path)


def extract_pptx_slides(path: Path) -> list[list[str]]:
    slides: list[list[str]] = []
    with zipfile.ZipFile(path) as package:
        slide_names = sorted(
            [name for name in package.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", name)],
            key=slide_sort_key,
        )
        for name in slide_names:
            root = ElementTree.fromstring(package.read(name))
            texts: list[str] = []
            for node in root.findall(".//a:t", TEXT_NS):
                if node.text and node.text.strip():
                    texts.append(node.text.strip())
            slides.append(texts)
    return slides


def render_html(title: str, source_rel: str, kind: str, slides: list[list[str]]) -> str:
    if slides:
        slide_html = "\n".join(
            f"""<section class="slide">
        <h2>Slide {index}</h2>
        {('<ul>' + ''.join(f'<li>{html.escape(text)}</li>' for text in texts) + '</ul>') if texts else '<p class="muted">No readable text was extracted from this slide.</p>'}
      </section>"""
            for index, texts in enumerate(slides, 1)
        )
        notice = "This is a lightweight in-site text preview extracted from the downloaded presentation file."
    else:
        slide_html = '<section class="slide"><p class="muted">A visual preview could not be generated in this environment. Use the download button to open the original file.</p></section>'
        notice = "This file is available for download; a full visual Office preview needs LibreOffice or Microsoft Office conversion on the server."

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ margin: 0; padding: 28px; background: #f5f7fb; color: #10233f; font-family: Arial, Helvetica, sans-serif; line-height: 1.55; }}
    main {{ max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #d8e2ef; border-radius: 8px; padding: 28px 34px; }}
    header {{ border-bottom: 1px solid #d8e2ef; margin-bottom: 22px; padding-bottom: 14px; }}
    h1 {{ font-size: 24px; margin: 0 0 8px; }}
    h2 {{ font-size: 18px; margin: 0 0 10px; }}
    .meta, .muted {{ color: #526681; font-size: 13px; }}
    .notice {{ background: #eef6ff; border: 1px solid #c9dff7; border-radius: 6px; color: #174a7c; font-size: 13px; margin: 0 0 18px; padding: 10px 12px; }}
    .slide {{ border: 1px solid #d8e2ef; border-radius: 6px; margin: 14px 0; padding: 16px 18px; }}
    ul {{ margin: 0; padding-left: 20px; }}
    li {{ margin: 6px 0; }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">Source: {html.escape(source_rel)} · Type: {html.escape(kind.upper())}</div>
    </header>
    <p class="notice">{html.escape(notice)}</p>
    {slide_html}
  </main>
</body>
</html>
"""


def render_download_only_html(title: str, source_rel: str, kind: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ margin: 0; padding: 28px; background: #f5f7fb; color: #10233f; font-family: Arial, Helvetica, sans-serif; line-height: 1.55; }}
    main {{ max-width: 860px; margin: 0 auto; background: #fff; border: 1px solid #d8e2ef; border-radius: 8px; padding: 28px 34px; }}
    h1 {{ font-size: 24px; margin: 0 0 8px; }}
    .meta {{ color: #526681; font-size: 13px; }}
    .notice {{ background: #eef6ff; border: 1px solid #c9dff7; border-radius: 6px; color: #174a7c; margin-top: 20px; padding: 12px 14px; }}
    a {{ color: #0b4f93; font-weight: 700; }}
  </style>
</head>
<body>
  <main>
    <h1>{html.escape(title)}</h1>
    <div class="meta">Source: {html.escape(source_rel)} · Type: {html.escape(kind.upper())}</div>
    <p class="notice">A visual in-site preview is not available for this legacy Office format. Use the original file download to open it in Word, PowerPoint, Excel, or a compatible viewer.</p>
  </main>
</body>
</html>
"""


def extract_legacy_doc_text(path: Path) -> list[str]:
    raw = path.read_bytes()
    text = raw.decode("cp1252", errors="ignore")
    text = text.replace("\x07", "\n").replace("\x0b", "\n").replace("\x0c", "\n")
    metadata_markers = (
        "[Content_Types].xml",
        "_rels/.rels",
        "theme/theme",
        "Normal.dotm",
        "Microsoft Office",
        "Root Entry",
        "WordDocument",
        "SummaryInformation",
        "DocumentSummaryInformation",
        "CompObj",
    )

    def is_metadata(value: str) -> bool:
        return any(marker in value for marker in metadata_markers)

    def normalize_legacy_line(value: str) -> str:
        return (
            value.replace("\u2013", "-")
            .replace("\u2014", "-")
            .replace("\u2018", "'")
            .replace("\u2019", "'")
            .replace("\u201c", '"')
            .replace("\u201d", '"')
        )

    def is_readable_line(value: str) -> bool:
        if not value or is_metadata(value):
            return False
        ascii_printable = sum(1 for char in value if char == "\t" or char == " " or 32 <= ord(char) <= 126)
        if ascii_printable / max(len(value), 1) < 0.88:
            return False
        letters = sum(1 for char in value if char.isalpha())
        digits = sum(1 for char in value if char.isdigit())
        alnum = letters + digits
        punctuation = sum(1 for char in value if not char.isalnum() and not char.isspace())
        if alnum == 0:
            return False
        lower = value.lower()
        if len(value) <= 6:
            return bool(digits or " " in value or lower in {"unit", "time", "exam", "total", "eng2d", "olc4o", "isp"})
        if punctuation / max(len(value), 1) > 0.35:
            return False
        return bool(re.search(r"[aeiouAEIOU]", value) or digits or " " in value)

    start_index = text.lower().find("course planning")
    if start_index >= 0:
        text = text[start_index:]
    marker_index = min((text.find(marker) for marker in metadata_markers if marker in text), default=-1)
    if marker_index >= 0:
        text = text[:marker_index]

    lines: list[str] = []
    rejected_after_content = 0
    for line in re.split(r"[\r\n]+", text):
        clean = normalize_legacy_line(re.sub(r"\s+", " ", line).strip())
        if not clean:
            continue
        if is_metadata(clean) and lines:
            break
        if is_readable_line(clean):
            lines.append(clean)
            rejected_after_content = 0
        elif lines:
            rejected_after_content += 1
            if rejected_after_content >= 8 and len(lines) >= 10:
                return lines

    if lines:
        return lines

    candidates: list[str] = []
    for chunk in re.findall(r"[\x09\x0a\x0d\x20-\x7e]{2,}", raw.decode("latin1", errors="ignore")):
        if is_metadata(chunk):
            chunk = chunk[: min((chunk.find(marker) for marker in metadata_markers if marker in chunk), default=len(chunk))]
        alpha_count = sum(1 for char in chunk if char.isalpha())
        if alpha_count >= 20:
            candidates.append(chunk.strip())
    if not candidates:
        return []
    body = max(candidates, key=lambda value: (sum(1 for char in value if char.isalpha()), len(value)))
    fallback_lines: list[str] = []
    for line in re.split(r"[\r\n]+", body):
        clean = normalize_legacy_line(re.sub(r"\s+", " ", line).strip())
        if is_readable_line(clean):
            fallback_lines.append(clean)
    return fallback_lines


def line_after(lines: list[str], pattern: str) -> str:
    regex = re.compile(pattern, re.IGNORECASE)
    for index, line in enumerate(lines):
        if regex.search(line) and index + 1 < len(lines):
            return lines[index + 1]
    return ""


def render_course_planning_html(title: str, source_rel: str, lines: list[str]) -> str:
    def find_line(pattern: str) -> str:
        regex = re.compile(pattern, re.IGNORECASE)
        return next((line for line in lines if regex.search(line)), "")

    subject_line = find_line(r"^Subject:")
    subject = subject_line
    grade = ""
    subject_match = re.search(r"Subject:\s*(.*?)\s+Grade\s*/\s*Level:\s*(.*)$", subject_line, re.IGNORECASE)
    if subject_match:
        subject = subject_match.group(1).strip()
        grade = subject_match.group(2).strip()
    code_line = find_line(r"^Course and Code:")
    code = re.sub(r"^Course and Code:\s*", "", code_line, flags=re.IGNORECASE).strip()

    time_rows: list[tuple[str, str, str]] = []
    try:
        time_start = next(index for index, line in enumerate(lines) if line.lower() == "time") + 1
    except StopIteration:
        time_start = -1
    index = time_start
    while index >= 0 and index + 2 < len(lines):
        if re.match(r"^total time$", lines[index], re.IGNORECASE):
            break
        if re.match(r"^unit\s+\d+", lines[index], re.IGNORECASE):
            time_rows.append((lines[index], lines[index + 1], lines[index + 2]))
            index += 3
        else:
            index += 1
    total_time = line_after(lines, r"^Total Time$")

    eval_start = 0
    weighting_seen = 0
    for idx, line in enumerate(lines):
        if re.match(r"^Approximate Weighting$", line, re.IGNORECASE):
            weighting_seen += 1
            if weighting_seen == 2:
                eval_start = idx + 1
                break

    eval_tokens: list[str] = []
    for line in lines[eval_start:]:
        if re.match(r"^The weightings that are shown", line, re.IGNORECASE):
            break
        eval_tokens.append(line.replace("–", "-"))

    pairs: list[tuple[str, str]] = []
    idx = 0
    while idx + 1 < len(eval_tokens):
        name = eval_tokens[idx].strip()
        weight = eval_tokens[idx + 1].strip()
        if re.match(r"^\d+%$", weight):
            pairs.append((name, weight))
            idx += 2
        else:
            idx += 1

    left_pairs: list[tuple[str, str]] = []
    right_pairs: list[tuple[str, str]] = []
    total_left = ("Course Evaluation", "70%")
    total_right = ("End-of-Course", "30%")
    for name, weight in pairs:
        lower = name.lower()
        if "course evaluation" in lower:
            total_left = (name, weight)
        elif "end-of" in lower:
            total_right = (name, weight)
        elif lower in {"exam", "isp"} or "literacy portfolio" in lower:
            right_pairs.append((name, weight))
        else:
            left_pairs.append((name, weight))

    note = find_line(r"^The weightings that are shown")
    achievement = find_line(r"^The final grade will be based")

    time_html = "\n".join(
        f"<tr><td><em>{html.escape(unit)}</em></td><td>{html.escape(unit_title)}</td><td><strong><em>{html.escape(time)}</em></strong></td></tr>"
        for unit, unit_title, time in time_rows
    )
    max_eval_rows = max(len(left_pairs), len(right_pairs), 1)
    grade_rows = []
    for row_index in range(max_eval_rows):
        left = left_pairs[row_index] if row_index < len(left_pairs) else ("", "")
        right = right_pairs[row_index] if row_index < len(right_pairs) else ("", "")
        right_class = " blank-cell" if not right[0] and row_index >= len(right_pairs) else ""
        grade_rows.append(
            "<tr>"
            f"<td>{html.escape(left[0])}</td><td class=\"weight\">{html.escape(left[1])}</td>"
            f"<td class=\"right-name{right_class}\">{html.escape(right[0])}</td><td class=\"weight{right_class}\">{html.escape(right[1])}</td>"
            "</tr>"
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ margin: 0; padding: 24px; background: #e7f0e5; color: #000; font-family: Arial, Helvetica, sans-serif; }}
    main {{ box-sizing: border-box; max-width: 980px; min-height: 1180px; margin: 0 auto; background: #d8eed4; padding: 42px 58px; }}
    h1 {{ font-size: 18px; margin: 0 0 22px; text-align: center; }}
    .meta-line {{ display: grid; grid-template-columns: 150px 1fr 140px 1fr; gap: 12px; font-size: 19px; margin: 10px 0; }}
    .section-title {{ font-size: 20px; font-style: italic; font-weight: 700; margin: 26px 0 4px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #000; padding: 6px 10px; vertical-align: middle; }}
    th {{ font-style: italic; font-weight: 700; text-align: center; }}
    .time-table td:first-child {{ text-align: center; width: 90px; }}
    .time-table td:nth-child(2) {{ font-family: Georgia, 'Times New Roman', serif; font-size: 21px; }}
    .time-table td:nth-child(3) {{ text-align: center; width: 120px; }}
    .total-row td {{ border-color: transparent; font-size: 19px; font-style: italic; font-weight: 700; text-align: right; }}
    .total-row td:last-child {{ border: 3px solid #000; font-style: normal; text-align: center; }}
    .grade-table th {{ font-size: 18px; }}
    .grade-table .small {{ font-size: 12px; font-weight: 400; line-height: 1.25; text-align: left; }}
    .grade-table td {{ font-size: 18px; }}
    .grade-table .weight {{ text-align: center; width: 105px; }}
    .grade-table .right-name {{ width: 210px; }}
    .grade-table .blank-cell {{ background: #000; color: #000; }}
    .summary-row td {{ border-top: 4px solid #000; font-weight: 700; }}
    .note {{ border: 1px solid #000; font-size: 16px; font-style: italic; line-height: 1.35; margin-top: 34px; padding: 10px; }}
    .source-note {{ color: #30503a; font-size: 12px; margin-bottom: 16px; }}
  </style>
</head>
<body>
  <main>
    <h1>Course Planning</h1>
    <div class="source-note">Preview generated from {html.escape(source_rel)}</div>
    <div class="meta-line"><strong>Subject:</strong><span>{html.escape(subject)}</span><strong>Grade / Level:</strong><span>{html.escape(grade)}</span></div>
    <div class="meta-line"><strong>Course and Code:</strong><span>{html.escape(code)}</span><span></span><span></span></div>
    <div class="section-title">Planning the Time</div>
    <table class="time-table">
      <thead><tr><th>Unit</th><th>Unit Title (Description)</th><th>Time</th></tr></thead>
      <tbody>
        {time_html}
        <tr class="total-row"><td></td><td>Total Time</td><td>{html.escape(total_time)}</td></tr>
      </tbody>
    </table>
    <div class="section-title">Planning for the Final Grade:</div>
    <table class="grade-table">
      <thead>
        <tr><th colspan="2">70% Course Evaluation</th><th colspan="2">30% End-of-Course Evaluation</th></tr>
        <tr>
          <td colspan="2" class="small">The following components will be used to base 70% of each student's final grade.</td>
          <td colspan="2" class="small">The following components will be administered near the end of the course and account for 30% of final grade.</td>
        </tr>
        <tr><th>Component</th><th>Approximate<br>Weighting</th><th>Component</th><th>Approximate<br>Weighting</th></tr>
      </thead>
      <tbody>
        {"".join(grade_rows)}
        <tr class="summary-row"><td>{html.escape(total_left[0])}</td><td class="weight">{html.escape(total_left[1])}</td><td>{html.escape(total_right[0])}</td><td class="weight">{html.escape(total_right[1])}</td></tr>
      </tbody>
    </table>
    <p class="note">{html.escape(note)}<br>{html.escape(achievement)}</p>
  </main>
</body>
</html>
"""


def continuation_joined(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if out and re.match(r"^[a-z]", line):
            out[-1] = f"{out[-1]} {line}"
        else:
            out.append(line)
    return out


def render_rubric_matrix_html(title: str, source_rel: str, lines: list[str]) -> str:
    normalized = continuation_joined([line.replace("–", "-") for line in lines])
    levels = [line for line in normalized if re.match(r"^Level\s+\d+\s*\(", line, re.IGNORECASE)][:4]
    categories = {"knowledge", "thinking/inquiry", "communication", "application"}
    response_title = next((line for line in reversed(normalized) if "response" in line.lower()), title)
    start = 4 if len(levels) == 4 else 0
    rows: list[tuple[str, str, list[list[str]]]] = []

    index = start
    while index < len(normalized):
        line = normalized[index]
        lower = line.lower()
        if "response" in lower:
            break
        if lower.rstrip("/") not in categories and lower not in categories:
            index += 1
            continue

        label_parts = [line]
        index += 1
        while index < len(normalized) and not re.match(r"^/\d+", normalized[index]):
            label_parts.append(normalized[index])
            index += 1
        score = normalized[index] if index < len(normalized) and re.match(r"^/\d+", normalized[index]) else ""
        if score:
            index += 1

        descriptors: list[str] = []
        while index < len(normalized):
            next_line = normalized[index]
            next_lower = next_line.lower().rstrip("/")
            if next_lower in categories or "response" in next_line.lower():
                break
            descriptors.append(next_line)
            index += 1

        if len(descriptors) >= 8:
            per_level = [
                descriptors[0:2],
                descriptors[2:4],
                descriptors[4:6],
                descriptors[6:8],
            ]
        else:
            per_level = [[item] for item in descriptors[:4]]
            while len(per_level) < 4:
                per_level.append([])

        label = "<br>".join(html.escape(part) for part in label_parts)
        rows.append((label, html.escape(score), per_level))

    body_rows = []
    for label, score, descriptors in rows:
        cells = []
        for level_descriptors in descriptors:
            paragraphs = "".join(f"<p>{html.escape(text)}</p>" for text in level_descriptors)
            cells.append(f"<td>{paragraphs}</td>")
        body_rows.append(
            "<tr>"
            f"<th class=\"criterion\"><span>{label}</span><span class=\"score\">{score}</span></th>"
            f"{''.join(cells)}"
            "</tr>"
        )

    level_headers = "".join(f"<th>{html.escape(level)}</th>" for level in levels)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ margin: 0; padding: 24px; background: #e7f0e5; color: #000; font-family: 'Times New Roman', Times, serif; }}
    main {{ box-sizing: border-box; min-width: 1220px; max-width: 1320px; min-height: 940px; margin: 0 auto; background: #d8eed4; padding: 46px 70px; }}
    h1 {{ color: #88938e; font-size: 22px; margin: 0 0 72px; text-align: center; }}
    table {{ border-collapse: collapse; table-layout: fixed; width: 100%; }}
    th, td {{ border: 1px solid #000; vertical-align: top; }}
    thead th {{ font-size: 18px; font-weight: 700; padding: 2px 8px; text-align: center; }}
    thead th:first-child {{ width: 178px; }}
    tbody th.criterion {{ font-size: 19px; font-weight: 700; padding: 4px 10px; position: relative; text-align: left; width: 178px; }}
    tbody th.criterion .score {{ bottom: 6px; font-weight: 400; position: absolute; right: 10px; }}
    td {{ font-size: 19px; line-height: 1.18; padding: 4px 10px; }}
    td p {{ margin: 0 0 38px; }}
    td p:last-child {{ margin-bottom: 0; }}
  </style>
</head>
<body>
  <main>
    <h1>{html.escape(response_title)}</h1>
    <table>
      <thead><tr><th></th>{level_headers}</tr></thead>
      <tbody>
        {"".join(body_rows)}
      </tbody>
    </table>
  </main>
</body>
</html>
"""


def render_legacy_doc_html(title: str, source_rel: str, lines: list[str]) -> str:
    if any(line.lower() == "course planning" for line in lines) and any("planning the time" in line.lower() for line in lines):
        return render_course_planning_html(title, source_rel, lines)
    if sum(1 for line in lines[:8] if re.match(r"^Level\s+\d+\s*\(", line, re.IGNORECASE)) >= 4:
        return render_rubric_matrix_html(title, source_rel, lines)

    body = "\n".join(html.escape(line) for line in lines)
    if not body:
        body = "No readable text was extracted from this legacy Word document. Use the download button to open the original file."
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ margin: 0; padding: 28px; background: #f5f7fb; color: #10233f; font-family: Arial, Helvetica, sans-serif; line-height: 1.55; }}
    main {{ max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #d8e2ef; border-radius: 8px; padding: 28px 34px; }}
    header {{ border-bottom: 1px solid #d8e2ef; margin-bottom: 22px; padding-bottom: 14px; }}
    h1 {{ font-size: 24px; margin: 0 0 8px; }}
    .meta {{ color: #526681; font-size: 13px; }}
    .notice {{ background: #eef6ff; border: 1px solid #c9dff7; border-radius: 6px; color: #174a7c; font-size: 13px; margin: 0 0 18px; padding: 10px 12px; }}
    pre {{ background: #fff; border: 1px solid #d8e2ef; border-radius: 6px; color: #10233f; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.65; margin: 0; overflow-wrap: anywhere; padding: 18px; white-space: pre-wrap; }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">Source: {html.escape(source_rel)} · Type: DOC</div>
    </header>
    <p class="notice">This is a lightweight in-site text preview extracted from the downloaded legacy Word file.</p>
    <pre>{body}</pre>
  </main>
</body>
</html>
"""


def render_image_html(title: str, source_rel: str, kind: str, image_href: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ margin: 0; padding: 28px; background: #f5f7fb; color: #10233f; font-family: Arial, Helvetica, sans-serif; line-height: 1.55; }}
    main {{ max-width: 1100px; margin: 0 auto; background: #fff; border: 1px solid #d8e2ef; border-radius: 8px; padding: 28px 34px; }}
    header {{ border-bottom: 1px solid #d8e2ef; margin-bottom: 22px; padding-bottom: 14px; }}
    h1 {{ font-size: 24px; margin: 0 0 8px; }}
    .meta {{ color: #526681; font-size: 13px; }}
    figure {{ margin: 0; }}
    img {{ display: block; max-width: 100%; height: auto; border: 1px solid #d8e2ef; border-radius: 6px; background: #fff; }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">Source: {html.escape(source_rel)} · Type: {html.escape(kind.upper())}</div>
    </header>
    <figure>
      <img src="{html.escape(image_href, quote=True)}" alt="{html.escape(title, quote=True)}">
    </figure>
  </main>
</body>
</html>
"""


def render_tiff_preview(source_abs: Path, preview_abs: Path) -> str:
    if Image is None:
        raise RuntimeError("Pillow is not installed; TIFF preview generation is unavailable.")
    image_abs = preview_abs.with_suffix(".png")
    image_abs.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_abs) as image:
        image.seek(0)
        frame = image.convert("RGBA") if image.mode in {"P", "LA", "RGBA"} else image.convert("RGB")
        frame.save(image_abs, "PNG")
    return Path(relpath(image_abs, preview_abs.parent)).as_posix()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lightweight HTML previews for Office and TIFF resources.")
    parser.add_argument("--course", required=True)
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    workspace_root = project_root.parent
    course_root = workspace_root / "courseware" / args.course.upper()
    manifest_path = course_root / "course-manifest.json"
    deployment_root = project_root / "deployment"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    generated = 0
    updated = 0
    failed: list[dict[str, str]] = []

    for item in iter_resource_items(manifest):
        source_rel = item.get("path", "")
        if not source_rel:
            continue
        suffix = Path(source_rel).suffix.lower()
        if suffix not in {".doc", ".xls", ".xlsx", ".ppt", ".pptx", ".tif", ".tiff"}:
            continue
        source_abs = course_root / source_rel
        if not source_abs.exists():
            failed.append({"label": item.get("label", ""), "path": source_rel, "error": "source missing"})
            continue

        preview_rel = f"previews-html/{sanitize_segment(source_rel)}.html"
        preview_abs = course_root / preview_rel
        try:
            if suffix == ".pptx":
                slides = extract_pptx_slides(source_abs)
                preview_html = render_html(item.get("label") or Path(source_rel).name, source_rel, suffix.removeprefix("."), slides)
            elif suffix == ".doc":
                preview_html = render_legacy_doc_html(item.get("label") or Path(source_rel).name, source_rel, extract_legacy_doc_text(source_abs))
            elif suffix in {".xls", ".xlsx", ".ppt"}:
                preview_html = render_download_only_html(item.get("label") or Path(source_rel).name, source_rel, suffix.removeprefix("."))
            else:
                image_href = render_tiff_preview(source_abs, preview_abs)
                preview_html = render_image_html(item.get("label") or Path(source_rel).name, source_rel, suffix.removeprefix("."), image_href)
        except Exception as exc:  # noqa: BLE001
            failed.append({"label": item.get("label", ""), "path": source_rel, "error": str(exc)})
            continue

        preview_abs.parent.mkdir(parents=True, exist_ok=True)
        preview_abs.write_text(preview_html, encoding="utf-8")
        generated += 1
        if item.get("previewPath") != preview_rel:
            item["previewPath"] = preview_rel
            updated += 1

    if updated:
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    deployment_root.mkdir(parents=True, exist_ok=True)
    report = {
        "course": args.course.upper(),
        "generatedPreviewFiles": generated,
        "manifestItemsUpdated": updated,
        "failures": failed,
    }
    (deployment_root / f"{args.course.upper()}-lightweight-office-preview-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
