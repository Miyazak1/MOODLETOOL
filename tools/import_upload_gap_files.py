from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"
SUPPORTED_EXTENSIONS = {".docx", ".pdf", ".pptx", ".xlsx", ".txt", ".md"}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_course(value: str) -> str:
    return "".join(ch for ch in value.upper() if ch.isalnum())


def safe_name(value: str) -> str:
    return (
        "".join(ch if ch.isalnum() or ch in "._- " else "-" for ch in str(value or ""))
        .strip()
        .replace(" ", "_")
        or "text"
    )


def candidates_for(item: dict[str, Any], inbox: Path, collection_inbox: Path | None) -> list[Path]:
    course = safe_course(item["course"])
    suggested = item.get("suggestedFilename") or ""
    paths: list[Path] = []
    if suggested:
        roots = [inbox, inbox / course]
        if collection_inbox:
            roots.extend([collection_inbox, collection_inbox / course])
        stem = Path(suggested).stem
        for root in roots:
            paths.append(root / suggested)
            for suffix in SUPPORTED_EXTENSIONS:
                paths.append(root / f"{stem}{suffix}")
    return paths


def find_source(item: dict[str, Any], inbox: Path, collection_inbox: Path | None) -> Path | None:
    seen: set[Path] = set()
    for candidate in candidates_for(item, inbox, collection_inbox):
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_EXTENSIONS:
            return candidate
    return None


def target_for(item: dict[str, Any], source: Path) -> Path:
    course = safe_course(item["course"])
    upload_type = item["uploadType"]
    suffix = source.suffix
    plans_root = COURSEWARE_ROOT / course / "plans"

    if upload_type == "course-outline":
        return plans_root / "course" / f"Course_Outline{suffix}"
    if upload_type == "course-introduction":
        return plans_root / "course" / f"Introduction{suffix}"
    if upload_type == "unit-plan":
        unit = int(item["unit"])
        return plans_root / "unit-plans" / f"U{unit:02d}_Unit_Plan{suffix}"
    if upload_type == "lesson-plan":
        unit = int(item["unit"])
        lesson = int(item["lesson"])
        return plans_root / "lesson-plans" / f"U{unit:02d}_L{lesson:02d}_Lesson_Plan{suffix}"
    if upload_type == "text-material":
        text_id = safe_name(item.get("textId") or item.get("textTitle") or source.stem).lower()
        return COURSEWARE_ROOT / course / "texts" / text_id / source.name

    raise ValueError(f"Unsupported direct upload type: {upload_type}")


def rebuild_manifest(course: str) -> None:
    script_name = "build_course_manifest.py" if course.upper() == "ENG3U" else "build_plan_course_manifest.py"
    script = PROJECT_ROOT / "tools" / script_name
    subprocess.run([sys.executable, str(script), "--course", course], check=True, cwd=WORKSPACE_ROOT)


def import_gap_files(
    checklist: Path,
    inbox: Path,
    collection_inbox: Path | None,
    *,
    dry_run: bool,
    move: bool,
    overwrite: bool,
    rebuild: bool,
) -> dict[str, Any]:
    data = read_json(checklist)
    imported: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    affected_courses: set[str] = set()

    for item in [*data.get("uploadItems", []), *data.get("reviewItems", [])]:
        source = find_source(item, inbox, collection_inbox)
        if not source:
            missing.append(
                {
                    "course": item.get("course"),
                    "uploadType": item.get("uploadType"),
                    "suggestedFilename": item.get("suggestedFilename"),
                }
            )
            continue

        target = target_for(item, source)
        if target.exists() and not overwrite:
            skipped.append(
                {
                    "course": item.get("course"),
                    "uploadType": item.get("uploadType"),
                    "source": str(source),
                    "target": str(target),
                    "reason": "target exists",
                }
            )
            continue

        if not dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            if move:
                shutil.move(str(source), target)
            else:
                shutil.copy2(source, target)
        affected_courses.add(safe_course(item["course"]))
        imported.append(
            {
                "course": item.get("course"),
                "uploadType": item.get("uploadType"),
                "source": str(source),
                "target": str(target),
            }
        )

    if rebuild and imported and not dry_run:
        for course in sorted(affected_courses):
            rebuild_manifest(course)

    return {
        "checklist": str(checklist),
        "inbox": str(inbox),
        "collectionInbox": str(collection_inbox) if collection_inbox else None,
        "dryRun": dry_run,
        "imported": imported,
        "missing": missing,
        "skipped": skipped,
        "affectedCourses": sorted(affected_courses),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import files that match deployment/upload-gap-checklist.json.")
    parser.add_argument("--checklist", type=Path, default=PROJECT_ROOT / "deployment" / "upload-gap-checklist.json")
    parser.add_argument("--inbox", type=Path, default=PROJECT_ROOT / "inbox" / "upload-gaps")
    parser.add_argument(
        "--collection-inbox",
        type=Path,
        default=PROJECT_ROOT / "inbox" / "collection" / "direct-uploads",
        help="Also look for collected files under this direct-uploads folder.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--move", action="store_true", help="Move files instead of copying them.")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacing existing target files.")
    parser.add_argument("--rebuild-manifest", action="store_true", help="Rebuild affected course manifests after importing.")
    args = parser.parse_args()

    result = import_gap_files(
        args.checklist,
        args.inbox,
        args.collection_inbox,
        dry_run=args.dry_run,
        move=args.move,
        overwrite=args.overwrite,
        rebuild=args.rebuild_manifest,
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not result["imported"]:
        print("No files imported. Place files in ossd-course-portal/inbox/upload-gaps or inbox/collection/direct-uploads using the suggested filenames.")


if __name__ == "__main__":
    main()
