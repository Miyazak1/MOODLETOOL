from __future__ import annotations

import argparse
import html
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


NAMESPACES = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}


def to_posix(value: str) -> str:
    return value.replace("\\", "/")


def sanitize_segment(value: str) -> str:
    value = to_posix(value).strip("/")
    return re.sub(r"[^A-Za-z0-9._/\- ]+", "_", value)


def iter_resource_items(manifest: dict[str, Any]):
    for item in manifest.get("courseDownloads", []):
        yield item

    for text in manifest.get("texts", []):
        for item in text.get("materials", []):
            yield item

    for unit in manifest.get("units", []):
        unit_plan = unit.get("unitPlan")
        if unit_plan:
            yield unit_plan

        for lesson in unit.get("lessons", []):
            lesson_plan = lesson.get("lessonPlan")
            if lesson_plan:
                yield lesson_plan

            for item in lesson.get("downloads", []):
                yield item

            for item in lesson.get("textExports", []):
                yield item


def paragraph_text(paragraph: ElementTree.Element) -> str:
    parts: list[str] = []
    for node in paragraph.iter():
        if node.tag == f"{{{NAMESPACES['w']}}}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{{{NAMESPACES['w']}}}tab":
            parts.append("\t")
        elif node.tag == f"{{{NAMESPACES['w']}}}br":
            parts.append("\n")
    return "".join(parts).strip()


def extract_docx_blocks(path: Path) -> list[tuple[str, list[str] | str]]:
    with zipfile.ZipFile(path) as package:
        document_xml = package.read("word/document.xml")

    root = ElementTree.fromstring(document_xml)
    body = root.find("w:body", NAMESPACES)
    if body is None:
        return [("paragraph", "No document body was found.")]

    blocks: list[tuple[str, list[str] | str]] = []
    for child in list(body):
        if child.tag == f"{{{NAMESPACES['w']}}}p":
            text = paragraph_text(child)
            if text:
                blocks.append(("paragraph", text))
        elif child.tag == f"{{{NAMESPACES['w']}}}tbl":
            rows: list[str] = []
            for row in child.findall("w:tr", NAMESPACES):
                cells: list[str] = []
                for cell in row.findall("w:tc", NAMESPACES):
                    cell_text = " ".join(
                        paragraph_text(p)
                        for p in cell.findall(".//w:p", NAMESPACES)
                        if paragraph_text(p)
                    )
                    cells.append(cell_text)
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                blocks.append(("table", rows))

    return blocks or [("paragraph", "No readable text was extracted from this document.")]


def clean_h5p_text(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def collect_h5p_strings(value: Any, results: list[str]) -> None:
    if len(results) >= 90:
        return
    if isinstance(value, str):
        cleaned = clean_h5p_text(value)
        if len(cleaned) >= 3 and cleaned not in results:
            results.append(cleaned[:500])
    elif isinstance(value, list):
        for item in value:
            collect_h5p_strings(item, results)
    elif isinstance(value, dict):
        for item in value.values():
            collect_h5p_strings(item, results)


def extract_h5p_blocks(path: Path) -> tuple[str, list[tuple[str, list[str] | str]]]:
    with zipfile.ZipFile(path) as package:
        package_meta = json.loads(package.read("h5p.json").decode("utf-8"))
        content_json = {}
        if "content/content.json" in package.namelist():
            content_json = json.loads(package.read("content/content.json").decode("utf-8"))

    title = package_meta.get("title") or content_json.get("title") or path.stem
    library = package_meta.get("mainLibrary") or package_meta.get("preloadedDependencies", [{}])[0].get("machineName", "")
    strings: list[str] = []
    collect_h5p_strings(content_json, strings)

    blocks: list[tuple[str, list[str] | str]] = []
    if library:
        blocks.append(("paragraph", f"H5P content type: {library}"))
    if strings:
        blocks.append(("table", strings))
    else:
        blocks.append(("paragraph", "No readable H5P text was extracted from this package."))
    return str(title), blocks


def render_preview_html(
    title: str,
    source_rel: str,
    blocks: list[tuple[str, list[str] | str]],
    notice: str,
) -> str:
    body_parts: list[str] = []
    for kind, content in blocks:
        if kind == "table" and isinstance(content, list):
            rows = "\n".join(f"<li>{html.escape(row)}</li>" for row in content)
            body_parts.append(f"<section class=\"doc-table\"><ul>{rows}</ul></section>")
        else:
            text = html.escape(str(content)).replace("\n", "<br>")
            body_parts.append(f"<p>{text}</p>")

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    :root {{
      color: #10233f;
      background: #f5f7fb;
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.55;
    }}
    body {{
      margin: 0;
      padding: 28px;
    }}
    main {{
      max-width: 980px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      padding: 28px 34px;
      box-shadow: 0 10px 26px rgba(16, 35, 63, 0.08);
    }}
    header {{
      border-bottom: 1px solid #d8e2ef;
      margin-bottom: 22px;
      padding-bottom: 14px;
    }}
    h1 {{
      font-size: 24px;
      margin: 0 0 8px;
    }}
    .meta {{
      color: #526681;
      font-size: 13px;
      word-break: break-word;
    }}
    .notice {{
      background: #eef6ff;
      border: 1px solid #c9dff7;
      border-radius: 6px;
      color: #174a7c;
      font-size: 13px;
      margin: 0 0 18px;
      padding: 10px 12px;
    }}
    p {{
      margin: 0 0 12px;
      white-space: normal;
    }}
    .doc-table {{
      background: #f8fafc;
      border: 1px solid #d8e2ef;
      border-radius: 6px;
      margin: 12px 0;
      padding: 12px 16px;
    }}
    .doc-table ul {{
      margin: 0;
      padding-left: 20px;
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">{html.escape(source_rel)}</div>
    </header>
    <div class="notice">{html.escape(notice)}</div>
    {"".join(body_parts)}
  </main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate lightweight in-site HTML previews for DOCX and H5P resources.")
    parser.add_argument("--course", required=True, help="Course code, for example ENG3U.")
    parser.add_argument("--workspace-root", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args()

    workspace_root = Path(args.workspace_root).resolve()
    course_root = workspace_root / "courseware" / args.course
    manifest_path = course_root / "course-manifest.json"
    report_path = workspace_root / "ossd-course-portal" / "deployment" / f"{args.course}-lightweight-preview-report.json"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    generated: dict[str, str] = {}
    generated_by_type = {"docx": 0, "h5p": 0}
    skipped: list[dict[str, str]] = []
    updated = 0

    for item in iter_resource_items(manifest):
        source_rel = to_posix(item.get("path", ""))
        ext = Path(source_rel).suffix.lower()
        if ext not in {".docx", ".h5p"}:
            continue

        source_path = course_root / source_rel
        preview_rel = f"previews-html/{sanitize_segment(source_rel)}.html"
        preview_path = course_root / preview_rel

        if not source_path.exists():
            skipped.append({"path": source_rel, "reason": "missing-source"})
            continue

        if source_rel not in generated:
            if ext == ".docx":
                blocks = extract_docx_blocks(source_path)
                title = item.get("label") or Path(source_rel).stem
                notice = "Lightweight in-site preview generated from DOCX text. Use the download button for the original layout."
                generated_by_type["docx"] += 1
            else:
                h5p_title, blocks = extract_h5p_blocks(source_path)
                title = item.get("label") or h5p_title
                notice = "Readable in-site preview generated from the H5P package. Use the download button for the original interactive package."
                generated_by_type["h5p"] += 1
            preview_path.parent.mkdir(parents=True, exist_ok=True)
            preview_path.write_text(render_preview_html(title, source_rel, blocks, notice), encoding="utf-8")
            generated[source_rel] = preview_rel

        if item.get("previewPath") != generated[source_rel]:
            item["previewPath"] = generated[source_rel]
            updated += 1

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {
        "course": args.course,
        "generatedPreviewFiles": len(generated),
        "generatedByType": generated_by_type,
        "manifestItemsUpdated": updated,
        "skipped": skipped,
        "previewRoot": "previews-html",
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not skipped else 1


if __name__ == "__main__":
    raise SystemExit(main())
