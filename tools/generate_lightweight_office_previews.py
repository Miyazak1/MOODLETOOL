from __future__ import annotations

import argparse
import html
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


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


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lightweight HTML previews for PPTX resources.")
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
        if suffix != ".pptx":
            continue
        source_abs = course_root / source_rel
        if not source_abs.exists():
            failed.append({"label": item.get("label", ""), "path": source_rel, "error": "source missing"})
            continue

        try:
            slides = extract_pptx_slides(source_abs)
        except Exception as exc:  # noqa: BLE001
            failed.append({"label": item.get("label", ""), "path": source_rel, "error": str(exc)})
            continue

        preview_rel = f"previews-html/{sanitize_segment(source_rel)}.html"
        preview_abs = course_root / preview_rel
        preview_abs.parent.mkdir(parents=True, exist_ok=True)
        preview_abs.write_text(
            render_html(item.get("label") or Path(source_rel).name, source_rel, suffix.removeprefix("."), slides),
            encoding="utf-8",
        )
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
