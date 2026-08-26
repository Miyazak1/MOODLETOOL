import json
import re
import sys
from pathlib import Path


WORKSPACE_ROOT = Path("D:/工作文件/SUNNYBROOK")
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"


def slug(value, limit=72):
    text = re.sub(r"[^A-Za-z0-9]+", "-", str(value or "")).strip("-").lower()
    return (text[:limit].strip("-") or "text-reference")


def all_units(manifest):
    values = []
    for unit in manifest.get("units") or []:
        try:
            values.append(int(unit.get("unit")))
        except (TypeError, ValueError):
            pass
    return values


def file_material(entry):
    material = {}
    for key in (
        "label",
        "title",
        "type",
        "category",
        "role",
        "path",
        "previewPath",
        "downloadPath",
        "bytes",
        "source",
        "sourceStatus",
        "generatedAt",
        "textPreview",
    ):
        if entry.get(key) is not None:
            material[key] = entry[key]
    if material.get("path") and not material.get("downloadPath"):
        material["downloadPath"] = material["path"]
    if material.get("path") and not material.get("previewPath") and material.get("type") in {"pdf", "html", "md"}:
        material["previewPath"] = material["path"]
    return material


def registry_entry(entry, units):
    if not isinstance(entry, dict):
        return None
    if isinstance(entry.get("units"), list) and isinstance(entry.get("materials"), list):
        if not entry.get("id"):
            entry["id"] = slug(entry.get("title") or entry.get("label") or entry.get("path"))
        if not entry.get("author"):
            entry["author"] = entry.get("publisher") or "Course resource"
        if not entry.get("title"):
            entry["title"] = entry.get("label") or entry.get("path") or "Text reference"
        if not entry.get("label"):
            entry["label"] = entry["title"]
        return entry

    title = entry.get("title") or entry.get("label") or entry.get("path") or "Text reference"
    material = file_material(entry)
    material.setdefault("label", title)
    material.setdefault("title", title)
    material.setdefault("category", entry.get("category") or "text_reference")
    material.setdefault("role", entry.get("role") or "text_reference")
    material.setdefault("type", entry.get("type") or "document")

    category = entry.get("category") or material.get("category") or "text_reference"
    role = entry.get("role") or material.get("role") or "text_reference"
    copyright_status = (
        "official_public_document"
        if "curriculum" in f"{category} {role} {title}".lower()
        else "local_teacher_prep_reference"
    )
    source_status = entry.get("sourceStatus") or "local"

    out = {
        **entry,
        "id": entry.get("id") or slug(title),
        "title": title,
        "label": entry.get("label") or title,
        "author": entry.get("author") or entry.get("publisher") or "Course resource",
        "type": entry.get("type") or material.get("type") or "document",
        "units": entry.get("units") if isinstance(entry.get("units"), list) else units,
        "copyrightStatus": entry.get("copyrightStatus") or copyright_status,
        "sourceStatus": source_status,
        "notes": entry.get("notes")
        or (
            "Official curriculum/reference file indexed for teacher preparation."
            if copyright_status == "official_public_document"
            else "Local teacher-prep/source note indexed for planning and upload QA."
        ),
        "materials": [material] if (material.get("path") or material.get("previewPath") or material.get("downloadPath")) else [],
    }
    return out


def normalize_course(course_code):
    manifest_path = COURSEWARE_ROOT / course_code / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    units = all_units(manifest)
    normalized = []
    seen = set()
    for entry in manifest.get("texts") or []:
        item = registry_entry(entry, units)
        if not item:
            continue
        key = (item.get("id") or item.get("title") or "").lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(item)
    manifest["texts"] = normalized
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"course": course_code, "texts": len(normalized)}


def main():
    courses = [code.upper() for code in sys.argv[1:]]
    if not courses:
        raise SystemExit("Usage: normalize-text-registry.py COURSE [COURSE...]")
    print(json.dumps([normalize_course(code) for code in courses], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
