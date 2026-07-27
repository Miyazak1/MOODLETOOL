from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
COURSE_DIR = WORKSPACE_ROOT / "courseware" / "ENG3U"
PLANS_DIR = COURSE_DIR / "plans"
DEFAULT_SOURCE = Path(
    os.environ.get(
        "OSSD_ENG3U_PLAN_SOURCE",
        r"D:\工作文件\OSSD\OSSD 课程教材大纲\OSSD 课程教材\Unit Plans and Lesson Plans\ENG3U",
    )
)

# Source ENG3U plan order differs from the current iSpring order.
# Target portal order:
# U1 Macbeth, U2 Frankenstein, U3 Media Studies, U4 Writing, U5 Short Stories.
SOURCE_UNIT_BY_TARGET_UNIT = {
    1: 5,
    2: 3,
    3: 4,
    4: 1,
    5: 2,
}

LESSON_COUNT_BY_TARGET_UNIT = {
    1: 7,
    2: 8,
    3: 8,
    4: 7,
    5: 6,
}


def copy_required(source: Path, target: Path, dry_run: bool) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Missing source file: {source}")
    print(f"{'Would copy' if dry_run else 'Copy'}: {source.name} -> {target.relative_to(WORKSPACE_ROOT)}")
    if dry_run:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def import_plans(source_root: Path, dry_run: bool) -> None:
    unit_target = PLANS_DIR / "unit-plans"
    lesson_target = PLANS_DIR / "lesson-plans"

    for target_unit, source_unit in SOURCE_UNIT_BY_TARGET_UNIT.items():
        source = source_root / f"Unit {source_unit}" / "Lesson _ Unit Plans" / f"ENG3U - Unit {source_unit} - Unit Plan.docx"
        target = unit_target / f"U{target_unit:02d}_Unit_Plan.docx"
        copy_required(source, target, dry_run)

    for target_unit, source_unit in SOURCE_UNIT_BY_TARGET_UNIT.items():
        for lesson_number in range(1, LESSON_COUNT_BY_TARGET_UNIT[target_unit] + 1):
            source = (
                source_root
                / f"Unit {source_unit}"
                / "Lesson _ Unit Plans"
                / f"Unit {source_unit} - Lesson {lesson_number} Lesson Plan.docx"
            )
            target = lesson_target / f"U{target_unit:02d}_L{lesson_number:02d}_Lesson_Plan.docx"
            copy_required(source, target, dry_run)

    for extra_name in ["U04_L08_Lesson_Plan.docx", "U05_L07_Lesson_Plan.docx"]:
        extra = lesson_target / extra_name
        if extra.exists():
            print(f"{'Would remove' if dry_run else 'Remove'} unreferenced plan: {extra.relative_to(WORKSPACE_ROOT)}")
            if not dry_run:
                extra.unlink()


def rebuild_manifest() -> None:
    script = PROJECT_ROOT / "tools" / "build_course_manifest.py"
    subprocess.run([sys.executable, str(script), "--course", "ENG3U"], check=True, cwd=WORKSPACE_ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import ENG3U OSSD plan set using the iSpring unit order.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rebuild-manifest", action="store_true")
    args = parser.parse_args()

    if not args.source.exists():
        raise FileNotFoundError(f"Source directory does not exist: {args.source}")
    import_plans(args.source, args.dry_run)
    if args.rebuild_manifest and not args.dry_run:
        rebuild_manifest()


if __name__ == "__main__":
    main()
