from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
COURSE_CODE = "ENG3U"
COURSE_DIR = WORKSPACE_ROOT / "courseware" / COURSE_CODE
INDEX_PATH = COURSE_DIR / f"{COURSE_CODE}_OFFLINE_INDEX.json"
OUTPUT_PATH = COURSE_DIR / "course-manifest.json"
PLANS_DIR = COURSE_DIR / "plans"
DOWNLOADABLE_EXTENSIONS = {".docx", ".pdf", ".pptx", ".xlsx", ".txt", ".md"}
EXISTING_PREVIEWS: dict[str, dict[str, str]] = {}


UNIT_TEXTS: dict[int, list[str]] = {
    1: ["macbeth"],
    2: ["frankenstein"],
    3: [],
    4: [],
    5: ["the-birthmark", "sunday-park", "borders", "train-from-rhodesia", "indian-education"],
}


TEXTS: list[dict[str, Any]] = [
    {
        "id": "macbeth",
        "title": "Macbeth",
        "author": "William Shakespeare",
        "type": "play",
        "units": [1],
        "copyrightStatus": "public_domain",
        "sourceStatus": "pending_download",
        "localMaterialPaths": [],
        "notes": "Core text for Unit 1.",
    },
    {
        "id": "frankenstein",
        "title": "Frankenstein",
        "author": "Mary Shelley",
        "type": "novel",
        "units": [2],
        "copyrightStatus": "public_domain",
        "sourceStatus": "pending_download",
        "localMaterialPaths": [],
        "notes": "Core text for Unit 2.",
    },
    {
        "id": "the-birthmark",
        "title": "The Birthmark",
        "author": "Nathaniel Hawthorne",
        "type": "short_story",
        "units": [5],
        "lessons": ["U5L1"],
        "copyrightStatus": "public_domain",
        "sourceStatus": "downloadable",
        "localMaterialPaths": [
            "Unit 5/Lesson 1 - Introduction to Short Stories/downloaded_resources_from_direct_index/homework/pdf/The_Birthmark-2.pdf",
        ],
        "notes": "Detected from Unit 5 resource filename The_Birthmark-2.pdf.",
    },
    {
        "id": "sunday-park",
        "title": "Sunday in the Park",
        "author": "Bel Kaufman",
        "type": "short_story",
        "units": [5],
        "lessons": ["U5L3"],
        "copyrightStatus": "copyrighted",
        "sourceStatus": "unavailable",
        "localMaterialPaths": [],
        "notes": "No source-text file found in Moodle/local resources; Moodle only contains response questions for Unit 5 Lesson 3.",
    },
    {
        "id": "borders",
        "title": "Borders",
        "author": "Thomas King",
        "type": "short_story",
        "units": [5],
        "lessons": ["U5L4"],
        "copyrightStatus": "copyrighted",
        "sourceStatus": "unavailable",
        "localMaterialPaths": [],
        "notes": "No source-text file found in Moodle/local resources; Moodle only contains response questions for Unit 5 Lesson 4.",
    },
    {
        "id": "train-from-rhodesia",
        "title": "Train from Rhodesia",
        "author": "Nadine Gordimer",
        "type": "short_story",
        "units": [5],
        "lessons": ["U5L5"],
        "copyrightStatus": "copyrighted",
        "sourceStatus": "pending_download",
        "localMaterialPaths": [
            "Unit 5/Lesson 5 - Psychoanalytic Lens/downloaded_resources_from_direct_index/homework/docx/Unit-5-Lesson-5-Train-from-Rhodesia-docxMarxism.docx",
        ],
        "notes": "Full literary text file required for Unit 5 Lesson 5 download.",
    },
    {
        "id": "indian-education",
        "title": "Indian Education",
        "author": "Sherman Alexie",
        "type": "short_story",
        "units": [5],
        "lessons": ["U5L6"],
        "copyrightStatus": "copyrighted",
        "sourceStatus": "unavailable",
        "localMaterialPaths": [],
        "notes": "No source-text file found in Moodle/local resources; Moodle only contains response questions for Unit 5 Lesson 6.",
    },
]


def rel(path: Path) -> str:
    return path.relative_to(COURSE_DIR).as_posix()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_existing_previews() -> None:
    if not OUTPUT_PATH.exists():
        return
    try:
        manifest = load_json(OUTPUT_PATH)
    except (json.JSONDecodeError, OSError):
        return

    def remember(item: dict[str, Any] | None) -> None:
        if not item or not item.get("path"):
            return
        preview: dict[str, str] = {}
        if item.get("previewPath"):
            preview["previewPath"] = item["previewPath"]
        if item.get("previewUrl"):
            preview["previewUrl"] = item["previewUrl"]
        if preview:
            EXISTING_PREVIEWS[item["path"]] = preview

    for item in manifest.get("courseDownloads", []):
        remember(item)
    for text in manifest.get("texts", []):
        for item in text.get("materials", []):
            remember(item)
    for unit in manifest.get("units", []):
        remember(unit.get("unitPlan"))
        for lesson in unit.get("lessons", []):
            remember(lesson.get("lessonPlan"))
            for item in lesson.get("downloads", []):
                remember(item)
            for item in lesson.get("textExports", []):
                remember(item)


def file_record(path: Path, category: str, role: str | None = None) -> dict[str, Any]:
    suffix = path.suffix.lower().lstrip(".") or "file"
    record = {
        "label": path.name,
        "type": suffix,
        "category": category,
        "role": role or category,
        "path": rel(path),
        "bytes": path.stat().st_size,
    }
    record.update(EXISTING_PREVIEWS.get(record["path"], {}))
    return record


def collect_text_materials(text: dict[str, Any]) -> list[dict[str, Any]]:
    materials: list[dict[str, Any]] = []
    for relative_path in text.get("localMaterialPaths", []):
        path = COURSE_DIR / relative_path
        if path.exists() and path.is_file():
            materials.append(file_record(path, "text_material", "core_text"))

    text_root = PLANS_DIR.parent / "texts"
    text_dir = text_root / text["id"]
    candidates: list[Path] = []
    if text_dir.exists():
        candidates.extend(path for path in text_dir.rglob("*") if path.is_file())
    candidates.extend(path for path in text_root.glob(f"{text['id']}.*") if path.is_file())

    seen = {item["path"] for item in materials}
    for path in sorted(candidates):
        if path.suffix.lower() not in DOWNLOADABLE_EXTENSIONS:
            continue
        record = file_record(path, "text_material", "core_text")
        if record["path"] in seen:
            continue
        seen.add(record["path"])
        materials.append(record)
    return materials


def text_manifest_record(text: dict[str, Any]) -> dict[str, Any]:
    materials = collect_text_materials(text)
    record = {key: value for key, value in text.items() if key != "localMaterialPaths"}
    if materials and record.get("sourceStatus") == "pending_download":
        record["sourceStatus"] = "downloadable"
    record["materials"] = materials
    return record


def first_matching_file(paths: list[Path]) -> dict[str, Any] | None:
    existing = [path for path in paths if path.exists() and path.is_file()]
    if not existing:
        return None
    return file_record(sorted(existing)[0], "teacher_plan", "plan")


def collect_course_downloads() -> list[dict[str, Any]]:
    course_dir = PLANS_DIR / "course"
    if not course_dir.exists():
        return []
    records: list[dict[str, Any]] = []
    for path in sorted(course_dir.glob("*")):
        if path.is_file() and path.suffix.lower() in DOWNLOADABLE_EXTENSIONS:
            name = path.name.lower()
            if "outline" in name:
                role = "course_outline"
            elif "intro" in name or "introduction" in name:
                role = "introduction"
            else:
                role = "course_document"
            records.append(file_record(path, "course_document", role))
    return records


def collect_unit_plan(unit_number: int) -> dict[str, Any] | None:
    unit_dir = PLANS_DIR / "unit-plans"
    candidates: list[Path] = []
    for pattern in [
        f"U{unit_number:02d}_Unit_Plan.*",
        f"U{unit_number}_Unit_Plan.*",
        f"Unit_{unit_number}_Plan.*",
        f"Unit {unit_number} Plan.*",
    ]:
        candidates.extend(unit_dir.glob(pattern))
    return first_matching_file(candidates)


def collect_lesson_plan(unit_number: int, lesson_number: int) -> dict[str, Any] | None:
    lesson_dir = PLANS_DIR / "lesson-plans"
    candidates: list[Path] = []
    for pattern in [
        f"U{unit_number:02d}_L{lesson_number:02d}_Lesson_Plan.*",
        f"U{unit_number}_L{lesson_number}_Lesson_Plan.*",
        f"Unit_{unit_number}_Lesson_{lesson_number}_Plan.*",
        f"Unit {unit_number} Lesson {lesson_number} Plan.*",
    ]:
        candidates.extend(lesson_dir.glob(pattern))
    return first_matching_file(candidates)


def collect_downloads(lesson_dir: Path) -> list[dict[str, Any]]:
    downloads: list[dict[str, Any]] = []

    text_export = lesson_dir / "text_export"
    if text_export.exists():
        for path in sorted(text_export.glob("*")):
            if path.is_file() and path.suffix.lower() in {".docx", ".txt"}:
                downloads.append(file_record(path, "lesson_text", "teacher_notes"))

    for base_name, source_label in [
        ("downloaded_resources_from_direct_index", "download"),
        ("downloaded_resources", "download"),
    ]:
        base = lesson_dir / base_name
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            if path.name.endswith(".failed.html") or path.name.endswith(".part"):
                continue
            if path.suffix.lower() not in {".docx", ".pdf", ".mp4", ".h5p", ".txt"}:
                continue
            parts = path.relative_to(base).parts
            role = parts[0] if parts else source_label
            downloads.append(file_record(path, source_label, role))

    seen: set[tuple[str, int]] = set()
    unique: list[dict[str, Any]] = []
    for item in downloads:
        key = (item["path"], item["bytes"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def collect_ispring(lesson_dir: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for presentation in sorted(lesson_dir.glob("html5-package*/presentation.html")):
        package_dir = presentation.parent
        data_dir = package_dir / "data"
        video_count = len(list(data_dir.glob("video*.mp4"))) if data_dir.exists() else 0
        slide_count = len(list(data_dir.glob("slide*.js"))) if data_dir.exists() else 0
        entries.append(
            {
                "label": package_dir.name,
                "mode": "page",
                "path": rel(presentation),
                "packagePath": rel(package_dir),
                **({"downloadPath": rel(package_dir.with_suffix(".zip"))} if package_dir.with_suffix(".zip").exists() else {}),
                "slideCount": slide_count,
                "videoSegmentCount": video_count,
            }
        )
    return entries


def load_unit_manifest(unit_number: int) -> dict[str, Any]:
    path = COURSE_DIR / f"Unit {unit_number}" / f"unit{unit_number}_manifest.json"
    return load_json(path) if path.exists() else {}


def make_unit_summary(lessons: list[dict[str, Any]]) -> dict[str, int]:
    totals = {"downloads": 0, "ispring": 0, "docx": 0, "pdf": 0, "video": 0, "h5p": 0}
    for lesson in lessons:
        totals["downloads"] += len(lesson["downloads"])
        totals["ispring"] += len(lesson["ispring"])
        for item in lesson["downloads"]:
            file_type = item["type"]
            if file_type == "mp4":
                totals["video"] += 1
            elif file_type in totals:
                totals[file_type] += 1
    return totals


def build_manifest() -> dict[str, Any]:
    offline_index = load_json(INDEX_PATH)
    grouped: dict[int, list[dict[str, Any]]] = {}

    for source_lesson in offline_index["lessons"]:
        unit_number = int(source_lesson["unit"])
        lesson_number = int(source_lesson["lesson"])
        lesson_dir = WORKSPACE_ROOT / source_lesson["path"]
        lesson_id = f"U{unit_number}L{lesson_number}"

        lesson_text = []
        for path_text in source_lesson.get("bookTextFiles", []):
            path = WORKSPACE_ROOT / path_text
            if path.exists():
                lesson_text.append(
                    {
                        "label": path.name,
                        "path": rel(path),
                        "type": path.suffix.lower().lstrip("."),
                    }
                )

        lesson = {
            "id": lesson_id,
            "unit": unit_number,
            "lesson": lesson_number,
            "title": source_lesson["title"],
            "path": rel(lesson_dir),
            "bookPageCount": source_lesson.get("bookPageCount", 0),
            "lessonText": lesson_text,
            "textExports": [
                item
                for item in collect_downloads(lesson_dir)
                if item["category"] == "lesson_text"
            ],
            "lessonPlan": collect_lesson_plan(unit_number, lesson_number),
            "ispring": collect_ispring(lesson_dir),
            "downloads": [
                item
                for item in collect_downloads(lesson_dir)
                if item["category"] != "lesson_text"
            ],
            "resourceCounts": source_lesson.get("resourceCounts", {}),
        }
        grouped.setdefault(unit_number, []).append(lesson)

    units: list[dict[str, Any]] = []
    for unit_number in sorted(grouped):
        unit_manifest = load_unit_manifest(unit_number)
        lessons = sorted(grouped[unit_number], key=lambda item: item["lesson"])
        unit_info = unit_manifest.get("unit", {})
        unit_manifest_title = unit_info.get("title") if isinstance(unit_info, dict) else None
        unit_title = unit_manifest_title or {
            1: "Macbeth",
            2: "Frankenstein",
            3: "Media Studies",
            4: "Novel Study / Essay Writing",
            5: "Short Stories",
        }.get(unit_number, f"Unit {unit_number}")
        units.append(
            {
                "unit": unit_number,
                "title": unit_title,
                "coreTexts": UNIT_TEXTS.get(unit_number, []),
                "unitPlan": collect_unit_plan(unit_number),
                "unitResources": unit_manifest.get("unitResources", {}),
                "summary": make_unit_summary(lessons),
                "lessons": lessons,
            }
        )

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "course": {
            "code": "ENG3U",
            "title": "English, Grade 11, University",
            "audience": "Teachers preparing OSSD lessons",
            "source": "SunnyBrook Moodle offline courseware",
        },
        "sourceAudit": offline_index.get("summary", {}),
        "navigation": {"primary": "unit", "secondary": "lesson"},
        "courseDownloads": collect_course_downloads(),
        "texts": [text_manifest_record(text) for text in TEXTS],
        "units": units,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a course manifest for the OSSD course portal.")
    parser.add_argument("--course", default=COURSE_CODE, help="Currently supports ENG3U.")
    args = parser.parse_args()
    if args.course.upper() != COURSE_CODE:
        raise SystemExit("Only ENG3U manifest generation is currently implemented.")

    load_existing_previews()
    manifest = build_manifest()
    OUTPUT_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_PATH}")
    print(f"Units: {len(manifest['units'])}")
    print(f"Lessons: {sum(len(unit['lessons']) for unit in manifest['units'])}")


if __name__ == "__main__":
    main()
