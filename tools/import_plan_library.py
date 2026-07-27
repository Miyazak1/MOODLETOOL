from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"
ADMIN_COURSES_PATH = PROJECT_ROOT / "public" / "admin-course-options.json"
CATALOG_PATH = PROJECT_ROOT / "public" / "course-catalog.json"
DEFAULT_SOURCE = Path(
    os.environ.get(
        "OSSD_PLAN_SOURCE",
        r"D:\工作文件\OSSD\OSSD 课程教材大纲\OSSD 课程教材\Unit Plans and Lesson Plans",
    )
)

SUPPORTED_EXTENSIONS = {".docx", ".doc", ".pdf", ".pptx", ".xlsx", ".txt", ".md"}
COURSE_DOCUMENT_PATTERNS = [
    re.compile(r"course[-_\s]*(outline|syllabus)", re.I),
    re.compile(r"curriculum[-_\s]*outline", re.I),
    re.compile(r"course[-_\s]*planning", re.I),
]
COURSE_CODE_PATTERN = re.compile(r"\b[A-Z]{3,4}\d[A-Z]\b", re.I)


def clean_label(value: str) -> str:
    value = re.sub(r"[_-]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or "Planning Document"


def safe_part(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*]+', "-", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or "Document"


def rel_to_course(path: Path, course_root: Path) -> str:
    return path.relative_to(course_root).as_posix()


def file_record(path: Path, course_root: Path, category: str, role: str, stat_path: Path | None = None) -> dict[str, Any]:
    suffix = path.suffix.lower().lstrip(".") or "file"
    stat_source = stat_path or path
    return {
        "label": clean_label(path.stem) + path.suffix,
        "type": suffix,
        "category": category,
        "role": role,
        "path": rel_to_course(path, course_root),
        "bytes": stat_source.stat().st_size,
    }


def copy_source_file(source: Path, source_course_root: Path, target_course_root: Path, dry_run: bool) -> Path:
    relative = source.relative_to(source_course_root)
    target = target_course_root / "plans" / "source" / Path(*[safe_part(part) for part in relative.parts])
    if dry_run:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return target


def is_supported_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name.startswith(".") or path.name.startswith("~$"):
        return False
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def has_foreign_course_code(course: str, path: Path, source_course_root: Path) -> bool:
    text = path.relative_to(source_course_root).as_posix().upper()
    codes = {match.upper() for match in COURSE_CODE_PATTERN.findall(text)}
    return bool(codes and course.upper() not in codes)


def is_course_document(path: Path) -> bool:
    text = path.as_posix()
    return any(pattern.search(text) for pattern in COURSE_DOCUMENT_PATTERNS)


def normalized_relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix().lower().replace("_", " ")


def normalized_parts(path: Path, root: Path) -> list[str]:
    return [part.lower().replace("_", " ").replace("-", " ") for part in path.relative_to(root).parts]


def is_unit_plan_file(path: Path, source_course_root: Path) -> bool:
    relative = normalized_relative(path, source_course_root)
    name = path.name.lower()
    parts = normalized_parts(path, source_course_root)
    explicit_unit_plan_dir = any(part in {"unit plan", "unit plans"} for part in parts[:-1])
    if "lesson" in name and "plan" in name:
        return False
    return (
        explicit_unit_plan_dir
        or ("unit" in name and "plan" in name and "lesson" not in name)
    )


def is_course_level_unit_plan(course: str, path: Path) -> bool:
    text = path.as_posix().lower().replace("_", " ").replace("-", " ")
    return course.upper() == "HHS4U" and "course planning" in text


def is_dual_unit_lesson_plan(course: str, path: Path) -> bool:
    name = path.name.lower().replace("_", " ").replace("-", " ")
    return course.upper() == "LKBDU" and re.search(r"\bunit\s*\d+\b.*\bdaily\s+lesson\s+plan\b", name) is not None


def is_lesson_plan_file(path: Path, source_course_root: Path) -> bool:
    relative = normalized_relative(path, source_course_root)
    name = path.name.lower()
    return (
        "lesson plans/" in relative
        or "lesson plan/" in relative
        or ("lesson" in name and "plan" in name)
        or re.search(r"\b(?:l|lesson)\s*[_-]?\s*\d{1,2}\b", name, flags=re.I) is not None
    )


def detect_unit(path: Path) -> int:
    text = path.as_posix()
    matches = re.findall(r"\b(?:u|unit)\s*[_-]?\s*(\d{1,2})\b", text, flags=re.I)
    if matches:
        return int(matches[0])
    return 1


def detect_lesson(path: Path) -> int | None:
    name = path.stem
    match = re.search(r"\b(?:l|lesson)\s*[_-]?\s*(\d{1,2})\b", name, flags=re.I)
    if match:
        return int(match.group(1))
    return None


def special_lesson_number(course: str, path: Path) -> int | None:
    if course.upper() != "CHV2O":
        return None
    name = path.name.lower().replace("_", " ").replace("-", " ")
    if "classwork" in name:
        return 1
    if "research" in name:
        return 2
    if "test" in name or "culminating" in name or "exam" in name:
        return 3
    return None


def unit_title(path: Path, unit_number: int) -> str:
    pattern = re.compile(rf"\b(?:u|unit)\s*[_-]?\s*{unit_number}\b\s*[-_ ]*(.*)", re.I)
    for part in path.parts:
        match = pattern.search(part)
        if match and match.group(1).strip():
            title = clean_label(match.group(1))
            if title.lower() in {"lesson plans & unit plans", "lesson plans and unit plans"}:
                return f"Unit {unit_number}"
            return title
    return f"Unit {unit_number}"


def lesson_title(path: Path, lesson_number: int | None) -> str:
    title = path.stem
    title = re.sub(r"\b[A-Z]{3,4}\d[A-Z]\b", "", title, flags=re.I)
    title = re.sub(r"\b(?:u|unit)\s*[_-]?\s*\d{1,2}\b", "", title, flags=re.I)
    title = re.sub(r"\b(?:l|lesson)\s*[_-]?\s*\d{1,2}\b", "", title, flags=re.I)
    title = re.sub(r"\blesson\s*plans?\b", "", title, flags=re.I)
    title = re.sub(r"\bunit\s*plans?\b", "", title, flags=re.I)
    title = clean_label(title)
    if title and title.lower() not in {"plan", "plans", "planning document"}:
        return title
    return f"Lesson {lesson_number or 1}"


def lesson_path(unit_number: int, lesson_number: int) -> str:
    return f"lessons/U{unit_number:02d}L{lesson_number:02d}"


def empty_lesson(unit_number: int, lesson_number: int, title: str) -> dict[str, Any]:
    return {
        "id": f"U{unit_number}L{lesson_number}",
        "unit": unit_number,
        "lesson": lesson_number,
        "title": title,
        "path": lesson_path(unit_number, lesson_number),
        "bookPageCount": 0,
        "lessonText": [],
        "textExports": [],
        "lessonPlan": None,
        "ispring": [],
        "downloads": [],
        "resourceCounts": {},
    }


def unit_overview_lesson(unit_number: int) -> dict[str, Any]:
    return {
        **empty_lesson(unit_number, 1, "Unit Overview"),
        "planningStatus": "unit_overview",
    }


def add_unit_overview_lessons(units: dict[int, dict[str, Any]]) -> None:
    for unit_number, unit in units.items():
        if unit.get("unitPlan") and not unit["lessons"]:
            unit["lessons"][1] = unit_overview_lesson(unit_number)


def collect_ispring(course_root: Path, lesson: dict[str, Any]) -> list[dict[str, Any]]:
    lesson_dir = course_root / lesson["path"]
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
                "path": rel_to_course(presentation, course_root),
                "packagePath": rel_to_course(package_dir, course_root),
                **({"downloadPath": rel_to_course(package_dir.with_suffix(".zip"), course_root)} if package_dir.with_suffix(".zip").exists() else {}),
                "slideCount": slide_count,
                "videoSegmentCount": video_count,
            }
        )
    return entries


def build_manifest(course: dict[str, Any], source_course_root: Path, dry_run: bool) -> dict[str, Any]:
    code = course["code"]
    course_root = COURSEWARE_ROOT / code
    copied: list[tuple[Path, Path]] = []
    for source in sorted(source_course_root.rglob("*")):
        if not is_supported_file(source):
            continue
        if has_foreign_course_code(code, source, source_course_root):
            continue
        target = copy_source_file(source, source_course_root, course_root, dry_run)
        copied.append((source, target))

    course_downloads: list[dict[str, Any]] = []
    units: dict[int, dict[str, Any]] = {}

    course_docs_root = course_root / "plans" / "course"
    if not dry_run and course_docs_root.exists():
        for path in sorted(course_docs_root.rglob("*")):
            if not is_supported_file(path):
                continue
            role = "course_document"
            if re.search(r"intro|introduction", path.name, re.I):
                role = "introduction"
            if re.search(r"outline|syllabus|curriculum", path.name, re.I):
                role = "course_outline"
            course_downloads.append(file_record(path, course_root, "course_document", role))

    def get_unit(unit_number: int, source_path: Path) -> dict[str, Any]:
        if unit_number not in units:
            units[unit_number] = {
                "unit": unit_number,
                "title": unit_title(source_path, unit_number),
                "coreTexts": [],
                "unitPlan": None,
                "unitResources": {},
                "summary": {"downloads": 0, "ispring": 0, "docx": 0, "pdf": 0, "video": 0, "h5p": 0},
                "lessons": {},
            }
        return units[unit_number]

    for source, target in copied:
        unit_number = detect_unit(source)
        lesson_number = detect_lesson(source) or special_lesson_number(code, source)
        name = source.name.lower()
        course_level_unit_plan = is_course_level_unit_plan(code, source)
        dual_unit_lesson_plan = is_dual_unit_lesson_plan(code, source)

        if is_course_document(source) and not course_level_unit_plan:
            role = "course_outline" if "outline" in name or "syllabus" in name else "course_document"
            course_downloads.append(file_record(target, course_root, "course_document", role, source))
            continue

        unit = get_unit(unit_number, source)
        record = file_record(target, course_root, "teacher_plan", "plan", source)

        if course_level_unit_plan or is_unit_plan_file(source, source_course_root) or dual_unit_lesson_plan:
            unit["unitPlan"] = record
            if not dual_unit_lesson_plan:
                continue

        if lesson_number is None:
            lesson_number = 1
        lessons = unit["lessons"]
        if lesson_number not in lessons:
            lessons[lesson_number] = empty_lesson(unit_number, lesson_number, lesson_title(source, lesson_number))
        if is_lesson_plan_file(source, source_course_root):
            lessons[lesson_number]["lessonPlan"] = record
        else:
            lessons[lesson_number]["downloads"].append(record)

    if code == "CHV2O":
        course_outline = next((item for item in course_downloads if item.get("role") == "course_outline"), None)
        if course_outline:
            unit = get_unit(1, source_course_root / "Unit 1")
            if not unit["unitPlan"]:
                unit["unitPlan"] = {**course_outline, "category": "teacher_plan", "role": "plan"}

    if not units:
        units[1] = {
            "unit": 1,
            "title": "Planning Documents",
            "coreTexts": [],
            "unitPlan": None,
            "unitResources": {},
            "summary": {"downloads": 0, "ispring": 0, "docx": 0, "pdf": 0, "video": 0, "h5p": 0},
            "lessons": {1: empty_lesson(1, 1, "Planning Documents")},
        }

    add_unit_overview_lessons(units)

    unit_records = []
    for unit_number in sorted(units):
        unit = units[unit_number]
        lessons = [unit["lessons"][lesson_number] for lesson_number in sorted(unit["lessons"])]
        for lesson in lessons:
            lesson["ispring"] = collect_ispring(course_root, lesson)
            downloadable = list(lesson["downloads"])
            if lesson["lessonPlan"]:
                downloadable.append(lesson["lessonPlan"])
            lesson["resourceCounts"] = {
                "downloads": len(lesson["downloads"]),
                "lessonPlan": 1 if lesson["lessonPlan"] else 0,
            }
            unit["summary"]["ispring"] += len(lesson["ispring"])
            for item in downloadable:
                if item["type"] in unit["summary"]:
                    unit["summary"][item["type"]] += 1
            unit["summary"]["downloads"] += len(lesson["downloads"])
        unit["lessons"] = lessons
        unit_records.append(unit)

    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "course": {
            "code": code,
            "title": f"{code} · {course['title']}",
            "audience": "Teachers preparing OSSD lessons",
            "source": "OSSD Unit Plans and Lesson Plans",
        },
        "sourceAudit": {
            "lessonCount": sum(len(unit["lessons"]) for unit in unit_records),
            "ispringExpected": 0,
            "ispringComplete": sum(len(lesson["ispring"]) for unit in unit_records for lesson in unit["lessons"]),
            "planningFileCount": len(copied),
        },
        "navigation": {"primary": "unit", "secondary": "lesson"},
        "courseDownloads": course_downloads,
        "texts": [],
        "units": unit_records,
    }

    if not dry_run:
        course_root.mkdir(parents=True, exist_ok=True)
        (course_root / "course-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def load_admin_courses() -> list[dict[str, Any]]:
    data = json.loads(ADMIN_COURSES_PATH.read_text(encoding="utf-8"))
    return data["courses"]


def write_catalog(courses: list[dict[str, Any]], include_eng3u: bool, dry_run: bool) -> None:
    catalog_courses = []
    for course in courses:
        code = course["code"]
        manifest_path = COURSEWARE_ROOT / code / "course-manifest.json"
        if not manifest_path.exists() and not (include_eng3u and code == "ENG3U"):
            continue
        catalog_courses.append(
            {
                "code": code,
                "title": f"{code} · {course['title']}",
                "level": course["grade"],
                "status": "ready" if code == "ENG3U" else "planning-only",
                "manifestUrl": f"/courseware/{code}/course-manifest.json",
                "baseUrl": f"/courseware/{code}/",
                "notes": "iSpring courseware included." if code == "ENG3U" else "Planning documents imported; iSpring not yet connected.",
            }
        )
    catalog_courses.sort(key=lambda item: (item["level"], item["code"]))
    catalog_courses.sort(key=lambda item: item["code"] != "ENG3U")
    catalog = {"schemaVersion": 1, "defaultCourse": "ENG3U", "courses": catalog_courses}
    if dry_run:
        print(f"Would write catalog courses: {len(catalog_courses)}")
        return
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import plan-only OSSD courses into courseware manifests.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--course", action="append", help="Course code to import. May be repeated.")
    parser.add_argument("--include-eng3u", action="store_true", help="Also generate ENG3U plan-only manifest. Off by default.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    courses = load_admin_courses()
    requested = {code.upper() for code in args.course or []}
    imported = 0
    for course in courses:
        code = course["code"]
        if requested and code not in requested:
            continue
        if code == "ENG3U" and not args.include_eng3u:
            continue
        source_course_root = args.source / code
        if not source_course_root.exists():
            print(f"Skip missing source course: {code}")
            continue
        manifest = build_manifest(course, source_course_root, args.dry_run)
        print(f"{'Would import' if args.dry_run else 'Imported'} {code}: units={len(manifest['units'])}, lessons={manifest['sourceAudit']['lessonCount']}, files={manifest['sourceAudit']['planningFileCount']}")
        imported += 1

    write_catalog(courses, include_eng3u=True, dry_run=args.dry_run)
    print(f"{'Would import' if args.dry_run else 'Imported'} courses: {imported}")


if __name__ == "__main__":
    main()
