from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"
ADMIN_COURSES_PATH = PROJECT_ROOT / "public" / "admin-course-options.json"
SUPPORTED_EXTENSIONS = {".docx", ".doc", ".pdf", ".pptx", ".xlsx", ".txt", ".md"}


def clean_label(value: str) -> str:
    value = re.sub(r"[_-]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or "Planning Document"


def course_meta(course: str) -> dict[str, str]:
    if ADMIN_COURSES_PATH.exists():
        data = json.loads(ADMIN_COURSES_PATH.read_text(encoding="utf-8"))
        for item in data.get("courses", []):
            if item.get("code") == course:
                return {"title": item.get("title", course), "grade": item.get("grade", "Unknown")}
    return {"title": course, "grade": "Unknown"}


def rel(path: Path, course_root: Path) -> str:
    return path.relative_to(course_root).as_posix()


def file_record(path: Path, course_root: Path, category: str, role: str) -> dict[str, Any]:
    suffix = path.suffix.lower().lstrip(".") or "file"
    return {
        "label": clean_label(path.stem) + path.suffix,
        "type": suffix,
        "category": category,
        "role": role,
        "path": rel(path, course_root),
        "bytes": path.stat().st_size,
    }


def is_supported_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name.startswith(".") or path.name.startswith("~$"):
        return False
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def detect_unit(path: Path) -> int:
    text = path.as_posix()
    matches = re.findall(r"\b(?:u|unit)\s*[_-]?\s*(\d{1,2})\b", text, flags=re.I)
    if matches:
        return int(matches[0])
    return 1


def detect_lesson(path: Path) -> int | None:
    text = path.as_posix()
    matches = re.findall(r"\b(?:l|lesson)\s*[_-]?\s*(\d{1,2})\b", text, flags=re.I)
    if matches:
        return int(matches[-1])
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


def lesson_title(path: Path, lesson_number: int) -> str:
    title = path.stem
    title = re.sub(r"\b[A-Z]{3,4}\d[A-Z]\b", "", title, flags=re.I)
    title = re.sub(r"\b(?:u|unit)\s*[_-]?\s*\d{1,2}\b", "", title, flags=re.I)
    title = re.sub(r"\b(?:l|lesson)\s*[_-]?\s*\d{1,2}\b", "", title, flags=re.I)
    title = re.sub(r"\blesson\s*plans?\b", "", title, flags=re.I)
    title = re.sub(r"\bunit\s*plans?\b", "", title, flags=re.I)
    title = clean_label(title)
    if title.lower() in {"plan", "plans", "planning document"}:
        return f"Lesson {lesson_number}"
    return title


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


def course_doc_role(path: Path) -> str | None:
    text = path.as_posix().lower()
    if "/plans/course/" in text or "\\plans\\course\\" in text:
        if "outline" in text or "syllabus" in text or "curriculum" in text:
            return "course_outline"
        if "intro" in text or "introduction" in text:
            return "introduction"
        return "course_document"
    if re.search(r"course[-_\s]*(outline|syllabus)", text) or "curriculum-outline" in text:
        return "course_outline"
    if re.search(r"course[-_\s]*planning", text):
        return "course_document"
    return None


def normalized_relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix().lower().replace("_", " ")


def normalized_parts(path: Path, root: Path) -> list[str]:
    return [part.lower().replace("_", " ").replace("-", " ") for part in path.relative_to(root).parts]


def is_unit_plan_file(path: Path, plans_root: Path) -> bool:
    relative = normalized_relative(path, plans_root)
    name = path.name.lower()
    parts = normalized_parts(path, plans_root)
    explicit_unit_plan_dir = any(part in {"unit plan", "unit plans"} for part in parts[:-1])
    if "lesson" in name and "plan" in name:
        return False
    return (
        relative.startswith("unit-plans/")
        or explicit_unit_plan_dir
        or ("unit" in name and "plan" in name and "lesson" not in name)
    )


def is_course_level_unit_plan(course: str, path: Path) -> bool:
    text = path.as_posix().lower().replace("_", " ").replace("-", " ")
    return course.upper() == "HHS4U" and "course planning" in text


def is_dual_unit_lesson_plan(course: str, path: Path) -> bool:
    name = path.name.lower().replace("_", " ").replace("-", " ")
    return course.upper() == "LKBDU" and re.search(r"\bunit\s*\d+\b.*\bdaily\s+lesson\s+plan\b", name) is not None


def is_lesson_plan_file(path: Path, plans_root: Path) -> bool:
    relative = normalized_relative(path, plans_root)
    name = path.name.lower()
    return (
        relative.startswith("lesson-plans/")
        or "lesson plans/" in relative
        or "lesson plan/" in relative
        or ("lesson" in name and "plan" in name)
        or re.search(r"\b(?:l|lesson)\s*[_-]?\s*\d{1,2}\b", name, flags=re.I) is not None
    )


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
                "path": rel(presentation, course_root),
                "packagePath": rel(package_dir, course_root),
                **({"downloadPath": rel(package_dir.with_suffix(".zip"), course_root)} if package_dir.with_suffix(".zip").exists() else {}),
                "slideCount": slide_count,
                "videoSegmentCount": video_count,
            }
        )
    return entries


def build_manifest(course: str) -> dict[str, Any]:
    course = course.upper()
    course_root = COURSEWARE_ROOT / course
    plans_root = course_root / "plans"
    if not plans_root.exists():
        raise FileNotFoundError(f"Plans directory does not exist: {plans_root}")

    meta = course_meta(course)
    course_downloads: list[dict[str, Any]] = []
    units: dict[int, dict[str, Any]] = {}

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

    files = [path for path in sorted(plans_root.rglob("*")) if is_supported_file(path)]
    for path in files:
        role = course_doc_role(path)
        course_level_unit_plan = is_course_level_unit_plan(course, path)
        dual_unit_lesson_plan = is_dual_unit_lesson_plan(course, path)
        if role and not course_level_unit_plan:
            course_downloads.append(file_record(path, course_root, "course_document", role))
            continue

        unit_number = detect_unit(path)
        lesson_number = detect_lesson(path) or special_lesson_number(course, path)
        unit = get_unit(unit_number, path)
        record = file_record(path, course_root, "teacher_plan", "plan")

        if course_level_unit_plan or is_unit_plan_file(path, plans_root) or dual_unit_lesson_plan:
            unit["unitPlan"] = record
            if not dual_unit_lesson_plan:
                continue

        if lesson_number is None:
            lesson_number = 1
        lessons = unit["lessons"]
        if lesson_number not in lessons:
            lessons[lesson_number] = empty_lesson(unit_number, lesson_number, lesson_title(path, lesson_number))
        if is_lesson_plan_file(path, plans_root):
            lessons[lesson_number]["lessonPlan"] = record
        else:
            lessons[lesson_number]["downloads"].append(record)

    if course == "CHV2O":
        course_outline = next((item for item in course_downloads if item.get("role") == "course_outline"), None)
        if course_outline:
            unit = get_unit(1, plans_root / "Unit 1")
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

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "course": {
            "code": course,
            "title": f"{course} · {meta['title']}",
            "audience": "Teachers preparing OSSD lessons",
            "source": "OSSD Unit Plans and Lesson Plans",
        },
        "sourceAudit": {
            "lessonCount": sum(len(unit["lessons"]) for unit in unit_records),
            "ispringExpected": 0,
            "ispringComplete": sum(len(lesson["ispring"]) for unit in unit_records for lesson in unit["lessons"]),
            "planningFileCount": len(files),
        },
        "navigation": {"primary": "unit", "secondary": "lesson"},
        "courseDownloads": course_downloads,
        "texts": [],
        "units": unit_records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a plan-only course manifest from courseware/<COURSE>/plans.")
    parser.add_argument("--course", required=True)
    args = parser.parse_args()

    manifest = build_manifest(args.course)
    output = COURSEWARE_ROOT / args.course.upper() / "course-manifest.json"
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
    print(f"Units: {len(manifest['units'])}")
    print(f"Lessons: {manifest['sourceAudit']['lessonCount']}")


if __name__ == "__main__":
    main()
