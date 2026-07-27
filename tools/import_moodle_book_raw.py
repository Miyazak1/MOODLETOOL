from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from build_lesson_book_sections_from_raw import build_sections


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"


LABEL_KIND = {
    "Lesson Expectations": "overview",
    "Lesson": "lesson",
    "Hands On": "handsOn",
    "Consolidation": "consolidation",
    "Homework": "homework",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def lesson_map(manifest: dict[str, Any]) -> dict[tuple[int, int], dict[str, Any]]:
    records: dict[tuple[int, int], dict[str, Any]] = {}
    for unit in manifest.get("units", []):
        for lesson in unit.get("lessons", []):
            records[(int(unit["unit"]), int(lesson["lesson"]))] = lesson
    return records


def import_raw(course: str, raw_paths: list[Path]) -> dict[str, Any]:
    course = course.upper()
    course_root = COURSEWARE_ROOT / course
    manifest_path = course_root / "course-manifest.json"
    manifest = read_json(manifest_path)
    by_lesson = lesson_map(manifest)
    imported: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []

    for raw_path in raw_paths:
        raw = read_json(raw_path)
        unit_number = int(raw["unit"])
        for raw_lesson in raw.get("lessons", []):
            lesson_number = int(raw_lesson["lesson"])
            lesson = by_lesson.get((unit_number, lesson_number))
            if not lesson:
                missing.append({"unit": unit_number, "lesson": lesson_number, "raw": str(raw_path)})
                continue
            pages = []
            for section in raw_lesson.get("sections", []):
                label = str(section.get("normalizedLabel") or section.get("label") or "").strip()
                page = section.get("page") or {}
                pages.append(
                    {
                        "kind": LABEL_KIND.get(label, ""),
                        "heading": page.get("heading") or [],
                        "html": page.get("html") or "",
                        "url": page.get("url") or section.get("url") or "",
                    },
                )
            lesson_dir = course_root / lesson["path"]
            lesson_dir.mkdir(parents=True, exist_ok=True)
            write_json(lesson_dir / "book_pages_raw.json", pages)
            imported.append({"unit": unit_number, "lesson": lesson_number, "pages": len(pages)})

    rebuilt = build_sections(course)
    return {"course": course, "rawFiles": [str(path) for path in raw_paths], "imported": imported, "missing": missing, "rebuilt": rebuilt}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import authenticated Moodle book raw JSON into per-lesson raw pages and rebuild sections.")
    parser.add_argument("--course", required=True)
    parser.add_argument("raw", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps(import_raw(args.course, args.raw), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
