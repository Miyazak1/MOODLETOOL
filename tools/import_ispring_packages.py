from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"


def read_manifest(course: str) -> dict[str, Any]:
    return json.loads((COURSEWARE_ROOT / course / "course-manifest.json").read_text(encoding="utf-8"))


def lesson_records(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {**lesson, "unitTitle": unit.get("title", "")}
        for unit in manifest.get("units", [])
        for lesson in unit.get("lessons", [])
    ]


def source_candidates(inbox: Path, collection_inbox: Path | None, course: str, lesson: dict[str, Any]) -> list[Path]:
    unit = int(lesson["unit"])
    lesson_number = int(lesson["lesson"])
    names = [
        f"{course}_U{unit:02d}_L{lesson_number:02d}.zip",
        f"{course}_U{unit:02d}L{lesson_number:02d}.zip",
        f"U{unit:02d}_L{lesson_number:02d}.zip",
        f"U{unit:02d}L{lesson_number:02d}.zip",
        f"{lesson['id']}.zip",
    ]
    roots = [inbox, inbox / course]
    if collection_inbox:
        roots.extend([collection_inbox, collection_inbox / course])
    return [root / name for root in roots for name in names]


def find_source(inbox: Path, collection_inbox: Path | None, course: str, lesson: dict[str, Any]) -> Path | None:
    for candidate in source_candidates(inbox, collection_inbox, course, lesson):
        if candidate.is_file():
            return candidate
    return None


def locate_presentation_dir(root: Path) -> Path | None:
    for presentation in sorted(root.rglob("presentation.html")):
        return presentation.parent
    return None


def rebuild_manifest(course: str) -> None:
    script_name = "build_course_manifest.py" if course.upper() == "ENG3U" else "build_plan_course_manifest.py"
    script = PROJECT_ROOT / "tools" / script_name
    subprocess.run([sys.executable, str(script), "--course", course], check=True, cwd=WORKSPACE_ROOT)


def install_package(source: Path, lesson_dir: Path, *, dry_run: bool, overwrite: bool) -> tuple[Path, str]:
    target = lesson_dir / "html5-package-admin"
    if target.exists() and not overwrite:
        return target, "skipped-target-exists"
    if dry_run:
        return target, "would-install"

    extract_root = lesson_dir / "_ispring_extract_tmp"
    if extract_root.exists():
        shutil.rmtree(extract_root)
    extract_root.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(source) as package:
            package.extractall(extract_root)
        presentation_dir = locate_presentation_dir(extract_root)
        if not presentation_dir:
            raise ValueError(f"{source} does not contain presentation.html")
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(presentation_dir, target)
        shutil.copy2(source, target.with_suffix(".zip"))
    finally:
        if extract_root.exists():
            shutil.rmtree(extract_root)
    return target, "installed"


def import_course(course: str, inbox: Path, collection_inbox: Path | None, *, dry_run: bool, overwrite: bool) -> dict[str, Any]:
    course = course.upper()
    manifest = read_manifest(course)
    course_root = COURSEWARE_ROOT / course
    installed: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for lesson in lesson_records(manifest):
        source = find_source(inbox, collection_inbox, course, lesson)
        if not source:
            missing.append({"course": course, "unit": lesson["unit"], "lesson": lesson["lesson"], "id": lesson["id"]})
            continue
        lesson_dir = course_root / lesson["path"]
        target, status = install_package(source, lesson_dir, dry_run=dry_run, overwrite=overwrite)
        record = {
            "course": course,
            "unit": lesson["unit"],
            "lesson": lesson["lesson"],
            "id": lesson["id"],
            "source": str(source),
            "target": str(target),
            "status": status,
        }
        if status.startswith("skipped"):
            skipped.append(record)
        else:
            installed.append(record)

    if installed and not dry_run:
        rebuild_manifest(course)

    return {"course": course, "installed": installed, "missing": missing, "skipped": skipped}


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch import iSpring ZIP packages by course/unit/lesson filename.")
    parser.add_argument("--course", action="append", required=True, help="Course code. May be repeated.")
    parser.add_argument("--inbox", type=Path, default=PROJECT_ROOT / "inbox" / "ispring")
    parser.add_argument(
        "--collection-inbox",
        type=Path,
        default=PROJECT_ROOT / "inbox" / "collection" / "ispring-batches",
        help="Also look for collected iSpring ZIPs under this ispring-batches folder.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    reports = [import_course(course, args.inbox, args.collection_inbox, dry_run=args.dry_run, overwrite=args.overwrite) for course in args.course]
    print(
        json.dumps(
            {"inbox": str(args.inbox), "collectionInbox": str(args.collection_inbox), "dryRun": args.dry_run, "reports": reports},
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
