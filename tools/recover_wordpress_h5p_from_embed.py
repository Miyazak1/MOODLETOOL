from __future__ import annotations

import argparse
import html
import json
import re
import ssl
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recover WordPress H5P packages from embed jsonContent.")
    parser.add_argument("--course", default="ESLCO")
    parser.add_argument("--workspace-root", default="..")
    parser.add_argument("--courseware-root")
    parser.add_argument("--ids", default="216,237,357,952,953,958")
    parser.add_argument("--template")
    return parser.parse_args()


def to_posix(value: str) -> str:
    return str(value or "").replace("\\", "/")


def slugify(value: str) -> str:
    value = html.unescape(str(value or "")).lower()
    value = value.replace("&", "and")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=45, context=context) as response:
        return response.read()


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8", errors="replace")


def extract_title(embed_html: str, fallback: str) -> str:
    match = re.search(r"<title>([\s\S]*?)</title>", embed_html, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", html.unescape(match.group(1) if match else fallback)).strip()


def extract_json_string(embed_html: str, key: str) -> str:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"', embed_html, flags=re.IGNORECASE)
    if not match:
        return ""
    return json.loads(f'"{match.group(1)}"')


def extract_library(embed_html: str) -> dict[str, str]:
    library = extract_json_string(embed_html, "library")
    match = re.match(r"^(.+?)\s+(\d+)\.(\d+)$", library)
    if not match:
        return {"mainLibrary": "H5P.QuestionSet", "machineName": "H5P.QuestionSet", "majorVersion": "1", "minorVersion": "17"}
    return {
        "mainLibrary": match.group(1),
        "machineName": match.group(1),
        "majorVersion": match.group(2),
        "minorVersion": match.group(3),
    }


def collect_asset_paths(value: Any, results: set[str] | None = None) -> set[str]:
    if results is None:
        results = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "path" and isinstance(item, str) and not re.match(r"^https?://", item, flags=re.IGNORECASE):
                normalized = to_posix(item).strip("/")
                if normalized and ".." not in Path(normalized).parts:
                    results.add(normalized)
            collect_asset_paths(item, results)
    elif isinstance(value, list):
        for item in value:
            collect_asset_paths(item, results)
    return results


def extract_wordpress_h5p_ids(page: dict[str, Any]) -> list[str]:
    page_html = str(page.get("html") or "").replace("&amp;", "&")
    return [match.group(1) for match in re.finditer(r"welcome\.hexstruct\.com/wp-admin/admin-ajax\.php\?action=h5p_embed&id=(\d+)", page_html, flags=re.IGNORECASE)]


def find_raw_book_pages(lesson_dir: Path) -> list[dict[str, Any]]:
    path = lesson_dir / "book_pages_raw.json"
    return read_json(path) if path.exists() else []


def resource_index(resources: list[dict[str, Any]], path: str, source: str) -> int:
    for index, item in enumerate(resources):
        if item.get("path") == path or item.get("source") == source:
            return index
    return -1


def write_recovered_h5p(
    *,
    template_path: Path,
    target_path: Path,
    content_id: str,
    title: str,
    content: dict[str, Any],
    library: dict[str, str],
) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    with zipfile.ZipFile(template_path, "r") as template:
        template_meta = json.loads(template.read("h5p.json").decode("utf-8-sig"))
        meta = {
            **template_meta,
            "title": title,
            "mainLibrary": library["mainLibrary"],
        }
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target_path, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for info in template.infolist():
                name = to_posix(info.filename).strip("/")
                if not name or info.is_dir():
                    continue
                if name == "h5p.json" or name == "content/content.json" or name.startswith("content/"):
                    continue
                output.writestr(name, template.read(info.filename))

            output.writestr("h5p.json", json.dumps(meta, ensure_ascii=False) + "\n")
            output.writestr("content/content.json", json.dumps(content, ensure_ascii=False) + "\n")

            for asset_path in sorted(collect_asset_paths(content)):
                url = f"https://welcome.hexstruct.com/wp-content/uploads/h5p/content/{content_id}/{asset_path}"
                try:
                    asset_bytes = fetch_bytes(url)
                    output.writestr(f"content/{asset_path}", asset_bytes)
                    assets.append({"path": asset_path, "bytes": len(asset_bytes)})
                except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                    assets.append({"path": asset_path, "error": str(exc)})
    return assets


def main() -> None:
    args = parse_args()
    workspace_root = Path(args.workspace_root).resolve()
    courseware_root = Path(args.courseware_root).resolve() if args.courseware_root else workspace_root / "courseware"
    course_root = courseware_root / args.course
    manifest_path = course_root / "course-manifest.json"
    template_path = (
        Path(args.template).resolve()
        if args.template
        else course_root
        / "lessons"
        / "U01L01"
        / "downloaded_resources"
        / "hands_on"
        / "h5p"
        / "eslco-unit-1-lesson-1-part-11-hands-on-activity-226.h5p"
    )
    wanted_ids = {item.strip() for item in args.ids.split(",") if item.strip()}

    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest: {manifest_path}")
    if not template_path.exists():
        raise SystemExit(f"Missing template H5P: {template_path}")

    manifest = read_json(manifest_path)
    recovered: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for unit in manifest.get("units", []):
        for lesson in unit.get("lessons", []):
            lesson_source_dir = lesson.get("sourceDir") or lesson.get("path") or ""
            lesson_dir = course_root / lesson_source_dir
            raw_pages = find_raw_book_pages(lesson_dir)
            hands_on_pages = [page for page in raw_pages if str(page.get("kind") or "").lower() == "handson"]
            for page in hands_on_pages:
                for content_id in extract_wordpress_h5p_ids(page):
                    if content_id not in wanted_ids:
                        continue
                    embed_url = f"https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id={content_id}"
                    try:
                        embed_html = fetch_text(embed_url)
                        lesson_code = f"U{int(unit.get('unit', 0)):02d}L{int(lesson.get('lesson', 0)):02d}"
                        title = extract_title(embed_html, f"{args.course}: {lesson_code} Hands On Activity")
                        json_content = extract_json_string(embed_html, "jsonContent")
                        if not json_content:
                            raise RuntimeError("Missing jsonContent in embed HTML")
                        content = json.loads(json_content)
                        library = extract_library(embed_html)
                        filename = f"{slugify(title)}-{content_id}.h5p"
                        rel_path = to_posix(str(Path(lesson_source_dir) / "downloaded_resources" / "hands_on" / "h5p" / filename))
                        target_path = course_root / rel_path
                        assets = write_recovered_h5p(
                            template_path=template_path,
                            target_path=target_path,
                            content_id=content_id,
                            title=title,
                            content=content,
                            library=library,
                        )
                        lesson.setdefault("downloads", [])
                        record = {
                            "label": f"Hands On Quiz - {title}",
                            "type": "h5p",
                            "category": "localized_moodle_resource",
                            "role": "hands_on",
                            "path": rel_path,
                            "source": embed_url,
                            "recoveredFromEmbed": True,
                            "bytes": target_path.stat().st_size,
                        }
                        existing = resource_index(lesson["downloads"], rel_path, embed_url)
                        if existing >= 0:
                            lesson["downloads"][existing] = {**lesson["downloads"][existing], **record}
                        else:
                            lesson["downloads"].append(record)
                        recovered.append(
                            {
                                "unit": unit.get("unit"),
                                "lesson": lesson.get("lesson"),
                                "id": content_id,
                                "title": title,
                                "path": rel_path,
                                "bytes": target_path.stat().st_size,
                                "assets": assets,
                            }
                        )
                    except Exception as exc:  # noqa: BLE001
                        skipped.append({"unit": unit.get("unit"), "lesson": lesson.get("lesson"), "id": content_id, "reason": str(exc)})

            lesson.setdefault("resourceCounts", {})
            lesson["resourceCounts"]["downloads"] = len(lesson.get("downloads", []))
            lesson["resourceCounts"]["h5p"] = len([item for item in lesson.get("downloads", []) if item.get("type") == "h5p"])

        unit.setdefault("summary", {})
        unit["summary"]["downloads"] = sum(len(lesson.get("downloads", [])) for lesson in unit.get("lessons", []))
        unit["summary"]["h5p"] = sum(
            len([item for item in lesson.get("downloads", []) if item.get("type") == "h5p"]) for lesson in unit.get("lessons", [])
        )

    manifest.setdefault("sourceAudit", {})
    manifest["sourceAudit"]["wordpressHandsOnH5pRecoveredFromEmbed"] = len(recovered)
    manifest["sourceAudit"]["wordpressHandsOnH5pRecoverySkipped"] = len(skipped)
    write_json(manifest_path, manifest)

    print(json.dumps({"course": args.course, "recovered": len(recovered), "skipped": skipped, "recoveredItems": recovered}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
