from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = WORKSPACE_ROOT / "ossd-course-portal"
COURSEWARE_ROOT = WORKSPACE_ROOT / "courseware"


def load_manifest(course: str) -> dict[str, Any]:
    path = COURSEWARE_ROOT / course / "course-manifest.json"
    if not path.exists():
        raise FileNotFoundError(f"Manifest not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def collect_ispring_packages(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    packages: list[dict[str, Any]] = []
    for unit in manifest.get("units", []):
        for lesson in unit.get("lessons", []):
            for item in lesson.get("ispring", []):
                packages.append(
                    {
                        "unit": unit.get("unit"),
                        "lesson": lesson.get("lesson"),
                        "lessonId": lesson.get("id"),
                        "title": lesson.get("title"),
                        "label": item.get("label"),
                        "packagePath": item.get("packagePath"),
                        "downloadPath": item.get("downloadPath"),
                    }
                )
    return packages


def zip_directory(source_dir: Path, target_zip: Path) -> int:
    target_zip.parent.mkdir(parents=True, exist_ok=True)
    tmp_zip = target_zip.with_suffix(target_zip.suffix + ".tmp")
    if tmp_zip.exists():
        tmp_zip.unlink()

    written = 0
    with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for path in sorted(source_dir.rglob("*")):
            if not path.is_file():
                continue
            archive.write(path, path.relative_to(source_dir.parent))
            written += 1
    tmp_zip.replace(target_zip)
    return written


def rebuild_manifest(course: str) -> None:
    script_name = "build_course_manifest.py" if course.upper() == "ENG3U" else "build_plan_course_manifest.py"
    script = PROJECT_ROOT / "tools" / script_name
    subprocess.run([sys.executable, str(script), "--course", course], cwd=WORKSPACE_ROOT, check=True)


def package_course(course: str, dry_run: bool, overwrite: bool, rebuild: bool) -> dict[str, Any]:
    course = course.upper()
    course_root = COURSEWARE_ROOT / course
    manifest = load_manifest(course)
    created = []
    skipped = []
    missing = []

    for package in collect_ispring_packages(manifest):
        package_rel = package.get("packagePath")
        if not package_rel:
            missing.append({**package, "reason": "missing packagePath"})
            continue
        source_dir = course_root / package_rel
        target_zip = source_dir.with_suffix(".zip")
        if not source_dir.exists() or not source_dir.is_dir():
            missing.append({**package, "reason": f"package folder missing: {source_dir}"})
            continue
        if target_zip.exists() and target_zip.stat().st_size > 0 and not overwrite:
            skipped.append({**package, "zip": str(target_zip), "reason": "zip already exists"})
            continue

        if dry_run:
            created.append({**package, "zip": str(target_zip), "files": None, "dryRun": True})
            continue

        files = zip_directory(source_dir, target_zip)
        created.append({**package, "zip": str(target_zip), "files": files, "bytes": target_zip.stat().st_size})

    if created and not dry_run and rebuild:
        rebuild_manifest(course)

    return {
        "course": course,
        "created": created,
        "skipped": skipped,
        "missing": missing,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Create downloadable ZIP files from installed iSpring HTML packages.")
    parser.add_argument("--course", action="append", help="Course code to process. May be repeated. Defaults to all courses with manifests.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--no-rebuild", action="store_true", help="Do not rebuild course manifests after creating ZIPs.")
    args = parser.parse_args()

    courses = [course.upper() for course in args.course] if args.course else sorted(path.name.upper() for path in COURSEWARE_ROOT.iterdir() if (path / "course-manifest.json").exists())
    reports = [package_course(course, args.dry_run, args.overwrite, not args.no_rebuild) for course in courses]

    for report in reports:
        created_bytes = sum(item.get("bytes", 0) for item in report["created"])
        print(
            f"{report['course']}: created {len(report['created'])}, skipped {len(report['skipped'])}, "
            f"missing {len(report['missing'])}, bytes {created_bytes}"
        )
        for item in report["missing"][:10]:
            print(f"  missing {item.get('lessonId')}: {item.get('reason')}")

    if any(report["missing"] for report in reports):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
