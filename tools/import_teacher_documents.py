from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
SUPPORTED_EXTENSIONS = {".docx", ".pdf", ".pptx", ".xlsx", ".txt", ".md"}


def clean_stem(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "_", value).strip("_")
    return value or "Document"


def classify_file(path: Path, plans_dir: Path) -> tuple[Path, str] | None:
    name = path.stem.lower()
    suffix = path.suffix
    if suffix.lower() not in SUPPORTED_EXTENSIONS:
        return None

    if ("course" in name and "outline" in name) or "syllabus" in name or "course_outline" in name:
        return plans_dir / "course" / f"Course_Outline{suffix}", "course outline"
    if "introduction" in name or re.search(r"\bintro\b", name):
        return plans_dir / "course" / f"Introduction{suffix}", "course introduction"

    unit_match = re.search(r"(?:^|[^0-9])u(?:nit)?[_\s-]*(\d{1,2})(?:[^0-9]|$)", name)
    lesson_match = re.search(r"(?:^|[^0-9])l(?:esson)?[_\s-]*(\d{1,2})(?:[^0-9]|$)", name)

    if unit_match and lesson_match:
        unit = int(unit_match.group(1))
        lesson = int(lesson_match.group(1))
        return (
            plans_dir / "lesson-plans" / f"U{unit:02d}_L{lesson:02d}_Lesson_Plan{suffix}",
            f"unit {unit} lesson {lesson} lesson plan",
        )

    if unit_match and "plan" in name:
        unit = int(unit_match.group(1))
        return plans_dir / "unit-plans" / f"U{unit:02d}_Unit_Plan{suffix}", f"unit {unit} unit plan"

    return plans_dir / "unclassified" / f"{clean_stem(path.stem)}{suffix}", "unclassified"


def unique_target(path: Path) -> Path:
    if not path.exists():
        return path
    counter = 2
    while True:
        candidate = path.with_name(f"{path.stem}_{counter}{path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def import_documents(
    inbox: Path,
    plans_dir: Path,
    move: bool = False,
    dry_run: bool = False,
) -> list[tuple[Path, Path, str]]:
    imported: list[tuple[Path, Path, str]] = []
    if not inbox.exists():
        if not dry_run:
            inbox.mkdir(parents=True, exist_ok=True)
        return imported

    for path in sorted(inbox.rglob("*")):
        if not path.is_file():
            continue
        if path.name.lower() == "readme.md" or path.name.startswith("."):
            continue
        classified = classify_file(path, plans_dir)
        if not classified:
            continue
        target, role = classified
        if not dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            target = unique_target(target)
            if move:
                shutil.move(str(path), str(target))
            else:
                shutil.copy2(path, target)
        imported.append((path, target, role))
    return imported


def rebuild_manifest(course: str) -> None:
    script_name = "build_course_manifest.py" if course.upper() == "ENG3U" else "build_plan_course_manifest.py"
    script = PROJECT_ROOT / "tools" / script_name
    subprocess.run(
        [sys.executable, str(script), "--course", course],
        check=True,
        cwd=WORKSPACE_ROOT,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Import teacher-provided OSSD course documents.")
    parser.add_argument("--course", default="ENG3U", help="Course code, for example ENG3U.")
    parser.add_argument("--inbox", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Preview classifications without copying or moving files.")
    parser.add_argument("--move", action="store_true", help="Move files instead of copying them.")
    parser.add_argument("--rebuild-manifest", action="store_true", help="Rebuild course-manifest.json after importing files.")
    args = parser.parse_args()

    course = args.course.upper()
    inbox = args.inbox or (PROJECT_ROOT / "inbox" / course)
    plans_dir = WORKSPACE_ROOT / "courseware" / course / "plans"

    imported = import_documents(inbox, plans_dir, move=args.move, dry_run=args.dry_run)
    print(f"Course: {course}")
    print(f"Inbox: {inbox}")
    print(f"{'Would import' if args.dry_run else 'Imported'}: {len(imported)}")
    for source, target, role in imported:
        print(f"- {role}: {source.name} -> {target.relative_to(WORKSPACE_ROOT)}")
    if not imported:
        print(f"No matching documents found. Put files in ossd-course-portal/inbox/{course}.")
    if args.rebuild_manifest and not args.dry_run:
        sys.stdout.flush()
        rebuild_manifest(course)


if __name__ == "__main__":
    main()
