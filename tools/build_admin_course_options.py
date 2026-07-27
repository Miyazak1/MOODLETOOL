from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"
DEFAULT_OUTPUT = PROJECT_ROOT / "public" / "admin-course-options.json"
DEFAULT_SOURCE = Path(
    os.environ.get(
        "OSSD_PLAN_SOURCE",
        r"D:\工作文件\OSSD\OSSD 课程教材大纲\OSSD 课程教材\Unit Plans and Lesson Plans",
    )
)

COURSE_META: dict[str, dict[str, str]] = {
    "BBB4M": {"title": "International Business Fundamentals", "grade": "Grade 12"},
    "BBI1O": {"title": "Introduction to Business", "grade": "Grade 9/10"},
    "BOH4M": {"title": "Business Leadership: Management Fundamentals", "grade": "Grade 12"},
    "CGW4U": {"title": "Canadian and World Issues", "grade": "Grade 12"},
    "CHC2D": {"title": "Canadian History since World War I", "grade": "Grade 10"},
    "CHV2O": {"title": "Civics and Citizenship", "grade": "Grade 10"},
    "ENG3U": {"title": "English", "grade": "Grade 11"},
    "ENG4U": {"title": "English", "grade": "Grade 12"},
    "ESLDO": {"title": "ESL Level 4", "grade": "ESL"},
    "ESLEO": {"title": "ESL Level 5", "grade": "ESL"},
    "GLC2O": {"title": "Career Studies", "grade": "Grade 10"},
    "HFA4U": {"title": "Nutrition and Health", "grade": "Grade 12"},
    "HFC3M": {"title": "Food and Culture", "grade": "Grade 11"},
    "HHS4U": {"title": "Families in Canada", "grade": "Grade 12"},
    "ICS3U": {"title": "Introduction to Computer Studies", "grade": "Grade 11"},
    "LKBDU": {"title": "International Languages, Simplified Chinese", "grade": "Grade 12"},
    "MCR3U": {"title": "Functions", "grade": "Grade 11"},
    "MCV4U": {"title": "Calculus and Vectors", "grade": "Grade 12"},
    "MDM4U": {"title": "Mathematics of Data Management", "grade": "Grade 12"},
    "MHF4U": {"title": "Advanced Functions", "grade": "Grade 12"},
    "MAP4C": {"title": "Foundations for College Mathematics", "grade": "Grade 12"},
    "MPM2D": {"title": "Principles of Mathematics", "grade": "Grade 10"},
    "SBI3U": {"title": "Biology", "grade": "Grade 11"},
    "SBI4U": {"title": "Biology", "grade": "Grade 12"},
    "SCH3U": {"title": "Chemistry", "grade": "Grade 11"},
    "SCH4U": {"title": "Chemistry", "grade": "Grade 12"},
    "SNC1D": {"title": "Science", "grade": "Grade 9"},
    "SNC2D": {"title": "Science", "grade": "Grade 10"},
    "SPH3U": {"title": "Physics", "grade": "Grade 11"},
    "SPH4U": {"title": "Physics", "grade": "Grade 12"},
}


def course_record(course_dir: Path) -> dict[str, Any]:
    code = course_dir.name.upper()
    meta = COURSE_META.get(code, {"title": code, "grade": "Unknown"})
    files = [
        path
        for path in course_dir.rglob("*")
        if path.is_file() and not path.name.startswith(".") and not path.name.startswith("~$")
    ]
    return {
        "code": code,
        "title": meta["title"],
        "grade": meta["grade"],
        "planningFileCount": len(files),
    }


def build_options(source: Path, default_course: str) -> dict[str, Any]:
    if not source.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source}")
    courses = [course_record(path) for path in sorted(source.iterdir()) if path.is_dir()]
    courses = [course for course in courses if course["planningFileCount"] > 0]
    existing_codes = {course["code"] for course in courses}
    if COURSEWARE_ROOT.exists():
        for course_dir in sorted(COURSEWARE_ROOT.iterdir()):
            code = course_dir.name.upper()
            if not course_dir.is_dir() or code in existing_codes:
                continue
            manifest_path = course_dir / "course-manifest.json"
            if manifest_path.exists():
                meta = COURSE_META.get(code, {"title": code, "grade": "Unknown"})
                courses.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "grade": meta["grade"],
                        "planningFileCount": 0,
                    }
                )
                existing_codes.add(code)
    return {
        "schemaVersion": 1,
        "source": str(source),
        "notes": "Textbook folders are intentionally excluded from admin upload categorization.",
        "defaultCourse": default_course,
        "courses": courses,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build admin course options from Unit Plans and Lesson Plans.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Path to the Unit Plans and Lesson Plans folder.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--default-course", default="ENG3U")
    args = parser.parse_args()

    data = build_options(args.source, args.default_course.upper())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
    print(f"Courses: {len(data['courses'])}")


if __name__ == "__main__":
    main()
