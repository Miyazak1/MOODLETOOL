from __future__ import annotations

import argparse
import html
import json
import re
import zipfile
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean_fragment(value: str) -> str:
    value = re.sub(r"<script\b[\s\S]*?</script>", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s(?:href|src)\s*=\s*['\"]https?://[^'\"]+['\"]", "", value, flags=re.IGNORECASE)
    return value


def h5p_sidecar_dir(path: Path) -> Path:
    return path.with_suffix("")


def ensure_content_files(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    sidecar = h5p_sidecar_dir(path)
    content_path = sidecar / "content.json"
    meta_path = sidecar / "h5p.json"
    if content_path.exists() and meta_path.exists():
        return load_json(content_path), load_json(meta_path)

    sidecar.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as package:
        content = json.loads(package.read("content/content.json").decode("utf-8-sig"))
        meta = json.loads(package.read("h5p.json").decode("utf-8-sig"))
    content_path.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return content, meta


def render_documentation_tool(content: dict[str, Any], meta: dict[str, Any], download_name: str) -> str:
    title = str(meta.get("title") or "H5P Activity")
    intro = clean_fragment(str(content.get("taskDescription") or ""))
    fields: list[dict[str, str]] = []
    for page in content.get("pagesList") or []:
        params = page.get("params") or {}
        for element in params.get("elementList") or []:
            library = str(element.get("library") or "")
            if not library.startswith("H5P.TextInputField"):
                continue
            element_params = element.get("params") or {}
            prompt_html = clean_fragment(str(element_params.get("taskDescription") or "Response"))
            prompt_text = re.sub(r"<[^>]+>", " ", prompt_html)
            prompt_text = re.sub(r"\s+", " ", prompt_text).strip() or "Response"
            fields.append({"promptHtml": prompt_html, "promptText": prompt_text})

    export_description = ""
    for page in content.get("pagesList") or []:
        if str(page.get("library") or "").startswith("H5P.DocumentExportPage"):
            export_description = clean_fragment(str((page.get("params") or {}).get("description") or ""))
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
    body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; color: #102033; background: #fff; line-height: 1.55; }}
    main {{ max-width: 900px; margin: 0 auto; padding: 28px 22px 42px; }}
    h1 {{ font-size: 26px; margin: 0 0 14px; }}
    .intro {{ color: #40536d; margin-bottom: 22px; }}
    .field {{ display: block; margin: 18px 0; }}
    .field span {{ display: block; font-weight: 700; margin-bottom: 8px; }}
    textarea {{ border: 1px solid #b7cbe5; border-radius: 8px; box-sizing: border-box; font: inherit; min-height: 96px; padding: 10px 12px; resize: vertical; width: 100%; }}
    .actions {{ border-top: 1px solid #d9e2ef; display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; padding-top: 18px; }}
    button {{ background: #0b4f71; border: 1px solid #0b4f71; border-radius: 6px; color: #fff; cursor: pointer; font: inherit; font-weight: 700; padding: 9px 13px; }}
    .hint {{ color: #586b85; flex-basis: 100%; }}
  </style>
</head>
<body>
  <main>
    <h1>{html.escape(title)}</h1>
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


def update_manifest(course_root: Path, resource_rel: str, preview_rel: str) -> None:
    manifest_path = course_root / "course-manifest.json"
    manifest = load_json(manifest_path)
    for unit in manifest.get("units", []):
        for lesson in unit.get("lessons", []):
            for item in lesson.get("downloads", []):
                if item.get("path") == resource_rel:
                    item["previewPath"] = preview_rel
    write_json(manifest_path, manifest)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--course", required=True)
    parser.add_argument("--resource", required=True, help="Resource path relative to the course root.")
    args = parser.parse_args()

    course = args.course.upper()
    course_root = (COURSEWARE_ROOT / course).resolve()
    resource_path = (course_root / args.resource).resolve()
    if not str(resource_path).startswith(str(course_root)) or not resource_path.exists():
        raise SystemExit(f"Resource not found inside course root: {resource_path}")

    content, meta = ensure_content_files(resource_path)
    if str(meta.get("mainLibrary") or "") != "H5P.DocumentationTool":
        raise SystemExit(f"Unsupported H5P main library: {meta.get('mainLibrary')}")

    output_path = h5p_sidecar_dir(resource_path) / "index.html"
    output_path.write_text(render_documentation_tool(content, meta, resource_path.name), encoding="utf-8")
    preview_rel = output_path.relative_to(course_root).as_posix()
    update_manifest(course_root, resource_path.relative_to(course_root).as_posix(), preview_rel)
    print(json.dumps({"resource": args.resource, "previewPath": preview_rel}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
