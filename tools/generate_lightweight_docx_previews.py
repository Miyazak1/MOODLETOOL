from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import posixpath
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote
from xml.etree import ElementTree


NAMESPACES = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}

SECTION_LABELS = {
    "assessment plan",
    "delivering the lesson",
    "materials and resources",
    "unit author",
    "unit details",
    "unit foundation",
    "unit overview",
}

FIELD_LABELS = {
    "accommodations",
    "approximate time needed",
    "curriculum expectations",
    "learning goals",
    "lesson and assessment outlines",
    "lesson name",
    "materials/resources",
    "other resources",
    "printed",
    "prior knowledge",
    "school city, province",
    "school district",
    "school name",
    "success criteria(s)",
    "targeted curriculum expectations",
    "technology",
    "unit of study",
    "unit summary",
    "unit title name",
    "year level",
}


def to_posix(value: str) -> str:
    return value.replace("\\", "/")


def sanitize_segment(value: str) -> str:
    value = to_posix(value).strip("/")
    return re.sub(r"[^A-Za-z0-9._/\- ]+", "_", value)


def iter_resource_items(manifest: dict[str, Any]):
    def yield_with_attachments(item: dict[str, Any]):
        yield item
        for attachment in item.get("attachments", []) or []:
            if isinstance(attachment, dict):
                yield from yield_with_attachments(attachment)

    for item in manifest.get("courseDownloads", []):
        yield from yield_with_attachments(item)

    for item in manifest.get("courseSections", []):
        yield from yield_with_attachments(item)

    for item in manifest.get("evaluations", []):
        yield from yield_with_attachments(item)

    for item in manifest.get("teacherResources", []):
        yield from yield_with_attachments(item)

    for text in manifest.get("texts", []):
        for item in text.get("materials", []):
            yield from yield_with_attachments(item)

    for unit in manifest.get("units", []):
        for value in (unit.get("unitResources") or {}).values():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        yield from yield_with_attachments(item)
            elif isinstance(value, dict):
                yield from yield_with_attachments(value)

        unit_plan = unit.get("unitPlan")
        if unit_plan:
            yield from yield_with_attachments(unit_plan)

        for lesson in unit.get("lessons", []):
            lesson_plan = lesson.get("lessonPlan")
            if lesson_plan:
                yield from yield_with_attachments(lesson_plan)

            for item in lesson.get("downloads", []):
                yield from yield_with_attachments(item)

            for item in lesson.get("textExports", []):
                yield from yield_with_attachments(item)


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


def cell_text(cell: ElementTree.Element) -> str:
    paragraphs = [
        paragraph_text(paragraph)
        for paragraph in cell.findall(".//w:p", NAMESPACES)
        if paragraph_text(paragraph)
    ]
    return "\n".join(paragraphs).strip()


def extract_docx_blocks(path: Path) -> list[tuple[str, Any]]:
    with zipfile.ZipFile(path) as package:
        document_xml = package.read("word/document.xml")
        media_blocks: list[tuple[str, Any]] = []
        for name in sorted(package.namelist()):
            if not name.lower().startswith("word/media/"):
                continue
            suffix = Path(name).suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
                continue
            mime_type = mimetypes.types_map.get(suffix, "application/octet-stream")
            encoded = base64.b64encode(package.read(name)).decode("ascii")
            media_blocks.append(
                (
                    "image",
                    {
                        "name": Path(name).name,
                        "mimeType": mime_type,
                        "data": encoded,
                    },
                )
            )

    root = ElementTree.fromstring(document_xml)
    body = root.find("w:body", NAMESPACES)
    if body is None:
        return media_blocks or [("paragraph", "No document body was found.")]

    blocks: list[tuple[str, Any]] = []
    for child in list(body):
        if child.tag == f"{{{NAMESPACES['w']}}}p":
            text = paragraph_text(child)
            if text:
                blocks.append(("paragraph", text))
        elif child.tag == f"{{{NAMESPACES['w']}}}tbl":
            rows: list[list[str]] = []
            for row in child.findall("w:tr", NAMESPACES):
                cells = [cell_text(cell) for cell in row.findall("w:tc", NAMESPACES)]
                if any(cells):
                    rows.append(cells)
            if rows:
                blocks.append(("table", rows))

    if media_blocks:
        blocks.extend(media_blocks)

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


def extract_h5p_blocks(path: Path) -> tuple[str, list[tuple[str, Any]]]:
    with zipfile.ZipFile(path) as package:
        package_meta = json.loads(package.read("h5p.json").decode("utf-8"))
        content_json = {}
        if "content/content.json" in package.namelist():
            content_json = json.loads(package.read("content/content.json").decode("utf-8"))

    title = package_meta.get("title") or content_json.get("title") or path.stem
    library = package_meta.get("mainLibrary") or package_meta.get("preloadedDependencies", [{}])[0].get("machineName", "")
    strings: list[str] = []
    collect_h5p_strings(content_json, strings)

    blocks: list[tuple[str, Any]] = []
    if library:
        blocks.append(("paragraph", f"H5P content type: {library}"))
    if strings:
        blocks.append(("table", strings))
    else:
        blocks.append(("paragraph", "No readable H5P text was extracted from this package."))
    return str(title), blocks


def clean_h5p_fragment(value: str) -> str:
    value = re.sub(r"<script\b[\s\S]*?</script>", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s(?:href|src)\s*=\s*['\"]https?://[^'\"]+['\"]", "", value, flags=re.IGNORECASE)
    return value


def read_h5p_content(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    with zipfile.ZipFile(path) as package:
        meta = json.loads(package.read("h5p.json").decode("utf-8-sig"))
        content = json.loads(package.read("content/content.json").decode("utf-8-sig"))
    return content, meta


def safe_extract_h5p_package(path: Path, target_dir: Path) -> None:
    target_root = target_dir.resolve()
    target_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as package:
        for member in package.infolist():
            member_name = to_posix(member.filename).strip("/")
            if not member_name or member_name.startswith(".") or ".." in Path(member_name).parts:
                raise ValueError(f"Unsafe H5P archive path: {member.filename}")
            destination = (target_root / member_name).resolve()
            if not str(destination).startswith(str(target_root)):
                raise ValueError(f"Unsafe H5P archive path: {member.filename}")
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.open(member) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output)


def render_h5p_standalone_player(meta: dict[str, Any], source_rel: str, download_name: str) -> str:
    title = str(meta.get("title") or Path(download_name).stem or "H5P Activity")
    library = str(meta.get("mainLibrary") or "")
    download_url = f"../{download_name}"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <link rel="stylesheet" href="/vendor/h5p-standalone/styles/h5p.css">
  <style>
    :root {{
      color: #10233f;
      background: #f3f6fa;
      font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 16px;
      line-height: 1.5;
    }}
    body {{
      margin: 0;
      padding: 28px 18px 42px;
    }}
    body.is-embedded {{
      background: #fff;
      padding: 0;
    }}
    main {{
      max-width: 1120px;
      margin: 0 auto;
    }}
    body.is-embedded main {{
      max-width: none;
    }}
    header {{
      background: #fff;
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      margin-bottom: 14px;
      padding: 18px 22px;
    }}
    h1 {{
      font-size: 24px;
      line-height: 1.25;
      margin: 0 0 6px;
    }}
    .meta {{
      color: #526681;
      font-size: 13px;
      overflow-wrap: anywhere;
    }}
    .player-shell {{
      background: #fff;
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      min-height: 220px;
      overflow: hidden;
    }}
    body.is-embedded header {{
      display: none;
    }}
    body.is-embedded .player-shell {{
      border: 0;
      border-radius: 0;
      min-height: 220px;
    }}
    #h5p-container {{
      min-height: 220px;
    }}
    .fallback {{
      background: #fff3f3;
      border: 1px solid #f0bbbb;
      border-radius: 8px;
      color: #7f1d1d;
      display: none;
      margin-top: 14px;
      padding: 12px 14px;
    }}
    .fallback a {{
      color: #0b4f71;
      font-weight: 700;
    }}
    @media (max-width: 720px) {{
      body {{
        padding: 0;
      }}
      header,
      .player-shell,
      .fallback {{
        border-left: 0;
        border-radius: 0;
        border-right: 0;
      }}
      h1 {{
        font-size: 20px;
      }}
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">{html.escape(source_rel)}</div>
      <div class="meta">H5P content type: {html.escape(library or "unknown")}</div>
    </header>
    <div class="player-shell">
      <div id="h5p-container"></div>
    </div>
    <div class="fallback" id="h5p-fallback">
      H5P playback failed. The package may be missing a required H5P library. You can still download the original file:
      <a href="{html.escape(download_url, quote=True)}">{html.escape(download_name)}</a>
    </div>
  </main>
  <script src="/vendor/h5p-standalone/main.bundle.js" charset="UTF-8"></script>
  <script>
    if (new URLSearchParams(window.location.search).get("embed") === "1") {{
      document.body.classList.add("is-embedded");
    }}
    document.addEventListener("DOMContentLoaded", function () {{
      const el = document.getElementById("h5p-container");
      const fallback = document.getElementById("h5p-fallback");
      const measurePlayerHeight = () => {{
        const shell = document.querySelector(".player-shell");
        const content =
          el.querySelector(".h5p-content") ||
          el.querySelector(".h5p-container") ||
          el.firstElementChild ||
          el;
        const shellRect = shell ? shell.getBoundingClientRect() : {{ top: 0 }};
        const contentRect = content.getBoundingClientRect();
        const measured = Math.max(contentRect.bottom - shellRect.top, contentRect.height);
        return Math.min(Math.max(Math.ceil(measured) + 10, 220), 900);
      }};
      const notifyParent = () => {{
        const height = measurePlayerHeight();
        if (window.parent && window.parent !== window) {{
          window.parent.postMessage({{ type: "ossd:h5p-height", height }}, "*");
        }}
      }};
      const options = {{
        h5pJsonPath: ".",
        librariesPath: ".",
        contentJsonPath: "./content",
        frameJs: "/vendor/h5p-standalone/frame.bundle.js",
        frameCss: "/vendor/h5p-standalone/styles/h5p.css",
        frame: true,
        export: true,
        downloadUrl: "{html.escape(download_url, quote=True)}",
        fullScreen: true
      }};
      try {{
        const player = new H5PStandalone.H5P(el, options);
        setTimeout(notifyParent, 500);
        setTimeout(notifyParent, 1500);
        setTimeout(notifyParent, 3000);
        if ("ResizeObserver" in window) {{
          const resizeObserver = new ResizeObserver(notifyParent);
          resizeObserver.observe(el);
        }}
        if (player && typeof player.catch === "function") {{
          player.catch(function (error) {{
            console.error(error);
            fallback.style.display = "block";
            notifyParent();
          }});
        }}
      }} catch (error) {{
        console.error(error);
        fallback.style.display = "block";
        notifyParent();
      }}
      window.addEventListener("resize", notifyParent);
      document.addEventListener("click", function () {{
        setTimeout(notifyParent, 250);
      }}, true);
    }});
  </script>
</body>
</html>
"""


def render_h5p_documentation_tool(content: dict[str, Any], meta: dict[str, Any], source_rel: str, download_name: str) -> str:
    title = str(meta.get("title") or "H5P Activity")
    intro = clean_h5p_fragment(str(content.get("taskDescription") or ""))
    fields: list[dict[str, str]] = []

    for page in content.get("pagesList") or []:
        params = page.get("params") or {}
        for element in params.get("elementList") or []:
            library = str(element.get("library") or "")
            if not library.startswith("H5P.TextInputField"):
                continue
            element_params = element.get("params") or {}
            prompt_html = clean_h5p_fragment(str(element_params.get("taskDescription") or "Response"))
            prompt_text = re.sub(r"<[^>]+>", " ", prompt_html)
            prompt_text = re.sub(r"\s+", " ", prompt_text).strip() or "Response"
            fields.append({"promptHtml": prompt_html, "promptText": prompt_text})

    export_description = ""
    for page in content.get("pagesList") or []:
        if str(page.get("library") or "").startswith("H5P.DocumentExportPage"):
            export_description = clean_h5p_fragment(str((page.get("params") or {}).get("description") or ""))
            break

    field_html = "\n".join(
        f"""
        <label class="field">
          <span>{field["promptHtml"]}</span>
          <textarea data-prompt="{html.escape(field["promptText"], quote=True)}" required></textarea>
        </label>
        """
        for field in fields
    )

    prompts = json.dumps([field["promptText"] for field in fields], ensure_ascii=False)
    filename = html.escape(download_name.replace(".h5p", "-responses.txt"), quote=True)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    :root {{
      color: #10233f;
      background: #f3f6fa;
      font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 16px;
      line-height: 1.6;
    }}
    body {{
      margin: 0;
      padding: 32px 20px;
    }}
    main {{
      max-width: 960px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      padding: 30px 38px 42px;
      box-shadow: 0 10px 26px rgba(16, 35, 63, 0.08);
    }}
    header {{
      border-bottom: 1px solid #d8e2ef;
      margin-bottom: 22px;
      padding-bottom: 14px;
    }}
    h1 {{
      font-size: 28px;
      line-height: 1.25;
      margin: 0 0 8px;
    }}
    .meta {{
      color: #526681;
      font-size: 13px;
      word-break: break-word;
    }}
    .notice {{
      background: #eef8f4;
      border: 1px solid #bfe2d5;
      border-radius: 6px;
      color: #075f46;
      font-size: 13px;
      margin: 0 0 22px;
      padding: 10px 12px;
    }}
    .intro {{
      color: #40536d;
      margin: 0 0 22px;
      max-width: 82ch;
    }}
    .field {{
      display: block;
      margin: 18px 0;
    }}
    .field span {{
      display: block;
      font-weight: 700;
      margin-bottom: 8px;
    }}
    textarea {{
      border: 1px solid #b7cbe5;
      border-radius: 8px;
      box-sizing: border-box;
      font: inherit;
      min-height: 108px;
      padding: 10px 12px;
      resize: vertical;
      width: 100%;
    }}
    .actions {{
      border-top: 1px solid #d9e2ef;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 22px;
      padding-top: 18px;
    }}
    button {{
      background: #0b4f71;
      border: 1px solid #0b4f71;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      padding: 9px 13px;
    }}
    .hint {{
      color: #586b85;
      flex-basis: 100%;
      font-size: 13px;
    }}
    @media (max-width: 720px) {{
      body {{
        padding: 0;
      }}
      main {{
        border-left: 0;
        border-radius: 0;
        border-right: 0;
        padding: 22px 18px 34px;
      }}
      h1 {{
        font-size: 23px;
      }}
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">{html.escape(source_rel)}</div>
    </header>
    <div class="notice">Local H5P activity page generated from the downloaded package. Use the download button in the portal for the original H5P file.</div>
    <div class="intro">{intro}</div>
    <form id="activity-form">
      {field_html}
      <div class="intro">{export_description}</div>
      <div class="actions">
        <button type="button" id="download-responses">Download responses</button>
        <span class="hint">Responses stay in this browser page until downloaded.</span>
      </div>
    </form>
  </main>
  <script>
    const prompts = {prompts};
    document.getElementById("download-responses").addEventListener("click", () => {{
      const answers = [...document.querySelectorAll("textarea")].map((field, index) => {{
        const prompt = prompts[index] || field.dataset.prompt || `Response ${{index + 1}}`;
        return `${{prompt}}\\n${{field.value.trim()}}`;
      }});
      const blob = new Blob([answers.join("\\n\\n") + "\\n"], {{ type: "text/plain;charset=utf-8" }});
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "{filename}";
      link.click();
      URL.revokeObjectURL(link.href);
    }});
  </script>
</body>
</html>
"""


def normalize_label(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" :").lower()


def non_empty_cells(row: list[str]) -> list[str]:
    return [cell.strip() for cell in row if cell.strip()]


def is_section_row(row: list[str]) -> bool:
    cells = non_empty_cells(row)
    return len(cells) == 1 and normalize_label(cells[0]) in SECTION_LABELS


def is_field_label(value: str) -> bool:
    return normalize_label(value) in FIELD_LABELS


def is_short_label(value: str) -> bool:
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        return False
    if len(text) > 86:
        return False
    if text.endswith(":") and len(text) <= 50:
        return True
    if normalize_label(text) in SECTION_LABELS | FIELD_LABELS:
        return True
    return text.isupper() and not re.search(r"[.!?]\s", text)


def is_table_heading(value: str) -> bool:
    text = re.sub(r"\s+", " ", value).strip()
    return bool(text) and len(text) <= 92 and not re.search(r"[.!?]\s", text)


def improve_text_flow(value: str) -> str:
    text = html.unescape(value)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    text = re.sub(r"\t+", "\n", text)
    text = re.sub(r"[ ]{2,}", " ", text)
    if len(text) > 180:
        text = re.sub(r"\s+(?=☑|☐|❐)", "\n", text)
        text = re.sub(r"\s+(?=\d+\.\d\s+[A-Za-z])", "\n", text)
        text = re.sub(
            r"\s+(?=(?:Overall|Specific|Reading And Literature Studies|Reading and Literature Studies|Writing|Oral Communication|Media Studies)\b)",
            "\n",
            text,
        )
        text = re.sub(r"\s+(?=Assessment:)", "\n", text)
        text = re.sub(r"\s+(?=ENG3U - Unit)", "\n", text)
        text = re.sub(
            r"\s+(?=Lesson (?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\b)",
            "\n",
            text,
        )
        text = re.sub(
            r"\s+(?=(?:Understand|Reflect|Be familiar|Name|Analyse|Analyze|Explain|Review|Learn about)\b)",
            "\n",
            text,
        )
    return text.strip()


def render_text(value: str, class_name: str = "text") -> str:
    lines = [line.strip() for line in improve_text_flow(value).splitlines() if line.strip()]
    if not lines:
        return ""
    if len(lines) == 1:
        return f"<p class=\"{class_name}\">{html.escape(lines[0])}</p>"
    if len(lines) <= 3:
        body = "<br>".join(html.escape(line) for line in lines)
        return f"<p class=\"{class_name}\">{body}</p>"
    items = "".join(f"<li>{html.escape(line)}</li>" for line in lines)
    return f"<ul class=\"text-lines {class_name}\">{items}</ul>"


def render_field(label: str, value: str = "") -> str:
    label_html = html.escape(label.strip().rstrip(":"))
    value_html = render_text(value, "field-value") if value.strip() else ""
    empty_class = " empty" if not value_html else ""
    return f"<section class=\"doc-field{empty_class}\"><h3>{label_html}</h3>{value_html}</section>"


def render_generic_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    first_row = non_empty_cells(rows[0])
    has_header = bool(first_row) and all(is_table_heading(cell) for cell in first_row)
    rendered_rows: list[str] = []
    for index, row in enumerate(rows):
        tag = "th" if index == 0 and has_header else "td"
        cells = "".join(f"<{tag}>{render_text(cell, 'table-text')}</{tag}>" for cell in row)
        rendered_rows.append(f"<tr>{cells}</tr>")
    return f"<div class=\"table-scroll\"><table>{''.join(rendered_rows)}</table></div>"


def render_docx_table(rows: list[list[str]]) -> str:
    parts: list[str] = []
    index = 0
    while index < len(rows):
        row = rows[index]
        cells = non_empty_cells(row)
        if not cells:
            index += 1
            continue

        if is_section_row(row):
            parts.append(f"<h2>{html.escape(cells[0])}</h2>")
            index += 1
            continue

        if len(cells) == 1:
            text = cells[0]
            next_cells = non_empty_cells(rows[index + 1]) if index + 1 < len(rows) else []
            if ":" in text and not text.endswith(":"):
                label, value = text.split(":", 1)
                if len(label.strip()) <= 60 and value.strip():
                    parts.append(render_field(label, value))
                    index += 1
                    continue
            if is_field_label(text) and len(next_cells) == 1 and not is_section_row(rows[index + 1]) and not is_short_label(next_cells[0]):
                parts.append(render_field(text, next_cells[0]))
                index += 2
            elif is_short_label(text) and len(next_cells) == 1 and not is_section_row(rows[index + 1]) and not is_short_label(next_cells[0]):
                parts.append(render_field(text, next_cells[0]))
                index += 2
            elif is_short_label(text):
                parts.append(render_field(text))
                index += 1
            else:
                parts.append(render_text(text, "body-text"))
                index += 1
            continue

        if len(cells) == 2 and is_short_label(cells[0]):
            parts.append(render_field(cells[0], cells[1]))
            index += 1
            continue

        table_rows = [row]
        index += 1
        while index < len(rows):
            next_row = rows[index]
            next_cells = non_empty_cells(next_row)
            if not next_cells or is_section_row(next_row) or len(next_cells) == 1:
                break
            table_rows.append(next_row)
            index += 1
        parts.append(render_generic_table(table_rows))

    return f"<section class=\"doc-table structured\">{''.join(parts)}</section>"


def course_href(value: str) -> str:
    return "/".join(quote(part) for part in to_posix(value).split("/"))


def relative_course_href(from_rel: str, to_rel: str) -> str:
    from_dir = posixpath.dirname(to_posix(from_rel))
    raw = posixpath.relpath(to_posix(to_rel), from_dir or ".")
    return course_href(raw)


def add_doc_heading_ids(body_html: str) -> tuple[str, list[dict[str, str]]]:
    headings: list[dict[str, str]] = []
    used: dict[str, int] = {}

    def replacement(match: re.Match[str]) -> str:
        raw = match.group(1)
        text = re.sub(r"<[^>]+>", " ", html.unescape(raw))
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return match.group(0)
        base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"
        used[base] = used.get(base, 0) + 1
        heading_id = base if used[base] == 1 else f"{base}-{used[base]}"
        headings.append({"id": heading_id, "text": text})
        return f'<h2 id="{html.escape(heading_id, quote=True)}">{raw}</h2>'

    return re.sub(r"<h2>(.*?)</h2>", replacement, body_html, flags=re.DOTALL), headings


def render_preview_html(
    title: str,
    source_rel: str,
    preview_rel: str,
    blocks: list[tuple[str, Any]],
    notice: str = "",
) -> str:
    body_parts: list[str] = []
    for kind, content in blocks:
        if kind == "table" and isinstance(content, list):
            if content and all(isinstance(row, list) for row in content):
                body_parts.append(render_docx_table(content))
            else:
                rows = "\n".join(f"<li>{html.escape(str(row))}</li>" for row in content)
                body_parts.append(f"<section class=\"doc-table\"><ul>{rows}</ul></section>")
        elif kind == "image" and isinstance(content, dict):
            mime_type = html.escape(str(content.get("mimeType") or "application/octet-stream"), quote=True)
            data = html.escape(str(content.get("data") or ""), quote=True)
            name = html.escape(str(content.get("name") or "Embedded image"))
            body_parts.append(
                f'<figure class="doc-image">'
                f'<img src="data:{mime_type};base64,{data}" alt="{name}">'
                f"<figcaption>{name}</figcaption>"
                f"</figure>"
            )
        else:
            body_parts.append(render_text(str(content), "body-text"))

    body_html, headings = add_doc_heading_ids("".join(body_parts))
    download_href = relative_course_href(preview_rel, source_rel)
    notice_html = f'<div class="notice">{html.escape(notice)}</div>' if notice else ""
    toc_html = ""
    if headings:
        toc_items = "".join(
            f'<a href="#{html.escape(item["id"], quote=True)}">{html.escape(item["text"])}</a>'
            for item in headings[:28]
        )
        toc_html = f'<nav class="doc-toc" aria-label="Document sections"><p>Contents</p>{toc_items}</nav>'

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    :root {{
      color: #10233f;
      background: #f3f6fa;
      font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 16px;
      line-height: 1.65;
    }}
    body {{
      margin: 0;
      padding: 24px 18px 72px;
    }}
    .ossd-doc-document {{
      max-width: 1180px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d8e2ef;
      border-radius: 10px;
      box-shadow: 0 14px 36px rgba(14, 44, 74, 0.08);
      overflow: hidden;
    }}
    .doc-hero {{
      border-bottom: 1px solid #d8e2ef;
      background: linear-gradient(180deg, #f8fbff 0%, #fff 100%);
      padding: 30px 36px 26px;
    }}
    .doc-kicker {{
      color: #58708e;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin: 0 0 8px;
      text-transform: uppercase;
    }}
    h1 {{
      color: #001f3f;
      font-size: 30px;
      line-height: 1.25;
      margin: 0 0 8px;
    }}
    h2 {{
      border-top: 1px solid #dbe7f3;
      color: #0f3764;
      font-size: 21px;
      line-height: 1.35;
      margin: 30px 0 14px;
      padding-top: 22px;
    }}
    h2:first-child {{
      border-top: 0;
      margin-top: 0;
      padding-top: 0;
    }}
    h3 {{
      color: #526681;
      font-size: 12px;
      letter-spacing: 0.06em;
      line-height: 1.35;
      margin: 0 0 6px;
      text-transform: uppercase;
    }}
    .meta {{
      color: #526681;
      font-size: 13px;
      overflow-wrap: anywhere;
    }}
    .doc-actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }}
    .doc-action {{
      align-items: center;
      background: #eef6ff;
      border: 1px solid #9fbfe5;
      border-radius: 6px;
      color: #003b72;
      display: inline-flex;
      font-size: 13px;
      font-weight: 800;
      min-height: 34px;
      padding: 0 12px;
      text-decoration: none;
    }}
    .doc-layout {{
      display: grid;
      gap: 28px;
      grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
      padding: 30px 36px 42px;
    }}
    .doc-layout.no-toc {{
      display: block;
    }}
    .doc-toc {{
      align-self: start;
      background: #f7faff;
      border: 1px solid #dbe7f3;
      border-radius: 8px;
      max-height: calc(100vh - 64px);
      overflow: auto;
      padding: 14px;
      position: sticky;
      top: 18px;
    }}
    .doc-toc p {{
      color: #58708e;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin: 0 0 10px;
      text-transform: uppercase;
    }}
    .doc-toc a {{
      border-left: 3px solid transparent;
      color: #153a62;
      display: block;
      font-size: 13px;
      line-height: 1.35;
      padding: 7px 8px;
      text-decoration: none;
    }}
    .doc-toc a:hover {{
      background: #eef6ff;
      border-left-color: #0b4f71;
    }}
    p {{
      margin: 0;
    }}
    .doc-content {{
      min-width: 0;
      color: #0f2743;
    }}
    .doc-table {{
      margin: 0;
    }}
    .doc-table ul {{
      margin: 0;
      padding-left: 20px;
    }}
    .doc-image {{
      margin: 0 auto 28px;
      max-width: 980px;
      text-align: center;
    }}
    .doc-image img {{
      background: #fff;
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      display: block;
      height: auto;
      margin: 0 auto;
      max-width: 100%;
    }}
    .doc-image figcaption {{
      color: #526681;
      font-size: 12px;
      margin-top: 8px;
    }}
    .doc-field {{
      background: #fbfdff;
      border: 1px solid #e1e8f1;
      border-radius: 8px;
      margin: 12px 0;
      padding: 14px 16px;
    }}
    .doc-field.empty {{
      background: transparent;
      border-style: dashed;
      color: #526681;
    }}
    .field-value,
    .body-text {{
      max-width: 78ch;
    }}
    .doc-content > .body-text {{
      color: #071f3d;
      font-family: Georgia, "Times New Roman", Times, serif;
      font-size: 18px;
      line-height: 1.86;
      max-width: 70ch;
      text-wrap: pretty;
    }}
    .doc-content > .body-text + .body-text {{
      margin-top: 0.72em;
    }}
    .doc-content > .body-text:first-child {{
      margin-top: 2px;
    }}
    .doc-field .field-value,
    .doc-field .text-lines,
    .table-text {{
      color: #17314f;
      font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 15px;
      line-height: 1.68;
    }}
    .text-lines {{
      margin: 0;
      max-width: 82ch;
      padding-left: 20px;
    }}
    .text-lines li {{
      margin: 4px 0;
      padding-left: 2px;
    }}
    .table-scroll {{
      border: 1px solid #d8e2ef;
      border-radius: 8px;
      margin: 14px 0;
      overflow-x: auto;
    }}
    table {{
      border-collapse: collapse;
      min-width: 100%;
      table-layout: fixed;
    }}
    th,
    td {{
      border: 1px solid #d8e2ef;
      padding: 11px 13px;
      text-align: left;
      vertical-align: top;
    }}
    th {{
      background: #eef3f8;
      color: #243b57;
      font-weight: 700;
    }}
    td {{
      background: #fff;
    }}
    th p,
    td p {{
      max-width: none;
    }}
    @media (max-width: 720px) {{
      body {{
        padding: 0;
      }}
      .ossd-doc-document {{
        border-left: 0;
        border-radius: 0;
        border-right: 0;
      }}
      .doc-hero {{
        padding: 24px 18px 20px;
      }}
      .doc-layout {{
        display: block;
        padding: 22px 18px 34px;
      }}
      .doc-toc {{
        margin-bottom: 20px;
        max-height: none;
        position: static;
      }}
      h1 {{
        font-size: 24px;
      }}
      .doc-content > .body-text {{
        font-size: 17px;
        line-height: 1.78;
        max-width: none;
      }}
      .doc-field {{
        padding: 11px 12px;
      }}
    }}
  </style>
</head>
<body>
  <main class="ossd-doc-document">
    <header class="doc-hero">
      <p class="doc-kicker">Course File Preview</p>
      <h1>{html.escape(title)}</h1>
      <div class="meta">{html.escape(source_rel)}</div>
      <div class="doc-actions">
        <a class="doc-action" href="{html.escape(download_href, quote=True)}" download>下载原始文件</a>
      </div>
    </header>
    <div class="doc-layout{' no-toc' if not headings else ''}">
      {toc_html}
      <article class="doc-content">
        {notice_html}
        {body_html}
      </article>
    </div>
  </main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate lightweight in-site HTML previews for DOCX and H5P resources.")
    parser.add_argument("--course", required=True, help="Course code, for example ENG3U.")
    parser.add_argument("--workspace-root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--course-root", default="", help="Optional absolute course directory. Defaults to <workspace-root>/courseware/<COURSE>.")
    args = parser.parse_args()

    workspace_root = Path(args.workspace_root).resolve()
    course_root = Path(args.course_root).resolve() if args.course_root else workspace_root / "courseware" / args.course
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
        if not source_path.exists():
            skipped.append({"path": source_rel, "reason": "missing-source"})
            continue

        if source_rel not in generated:
            if ext == ".docx":
                preview_rel = f"previews-html/{sanitize_segment(source_rel)}.html"
                preview_path = course_root / preview_rel
                try:
                    blocks = extract_docx_blocks(source_path)
                except zipfile.BadZipFile:
                    skipped.append({"path": source_rel, "reason": "encrypted-or-unsupported-docx"})
                    if item.pop("previewPath", None):
                        updated += 1
                    continue
                title = item.get("label") or Path(source_rel).stem
                preview_path.parent.mkdir(parents=True, exist_ok=True)
                preview_path.write_text(render_preview_html(title, source_rel, preview_rel, blocks), encoding="utf-8")
                generated_by_type["docx"] += 1
            else:
                try:
                    _content, meta = read_h5p_content(source_path)
                    preview_rel = f"{source_rel[:-4]}/index.html"
                    preview_path = course_root / preview_rel
                    safe_extract_h5p_package(source_path, preview_path.parent)
                    preview_path.write_text(
                        render_h5p_standalone_player(meta, source_rel, source_path.name),
                        encoding="utf-8",
                    )
                except Exception as exc:
                    preview_rel = f"previews-html/{sanitize_segment(source_rel)}.html"
                    preview_path = course_root / preview_rel
                    h5p_title, blocks = extract_h5p_blocks(source_path)
                    title = item.get("label") or h5p_title
                    notice = f"H5P standalone player generation failed: {exc}. Readable fallback generated from package text."
                    preview_path.parent.mkdir(parents=True, exist_ok=True)
                    preview_path.write_text(render_preview_html(title, source_rel, preview_rel, blocks, notice), encoding="utf-8")
                generated_by_type["h5p"] += 1
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
    fatal_skipped = [item for item in skipped if item.get("reason") != "encrypted-or-unsupported-docx"]
    return 0 if not fatal_skipped else 1


if __name__ == "__main__":
    raise SystemExit(main())
