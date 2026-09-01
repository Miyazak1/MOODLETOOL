import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from promote_teacher_prep_hhs_lkb_bbi1 import (  # noqa: E402
    COURSEWARE_ROOT,
    GENERATED_AT,
    REPO_ROOT,
    create_lesson_doc,
    create_unit_doc,
    ensure_dir,
    item_exists,
    plan_item,
    rel,
    resource_item,
    slug,
    text_registry_item,
    update_bytes,
    upsert,
    generated_plan_path,
)


REPORT_PATH = REPO_ROOT / "deployment" / "teacher-prep-promotion-AVI1O-AVI3M-BTT1O.json"


PROFILES = {
    "AVI1O": {
        "subject": "Visual Arts",
        "grade": "Grade 9, Open",
        "curriculum_title": "The Ontario Curriculum, Grades 9 and 10: The Arts, 2010 (Revised)",
        "curriculum_url": "https://www.publications.gov.on.ca/ontario-curriculum-grades-9-and-10-the-arts-2010-revised",
        "source_url": "local AVI1O Moodle course package",
        "course_lens": "exploratory visual arts learning through elements and principles of design, creative process, critical analysis, studio practice, art vocabulary, and personal portfolio evidence.",
        "unit_focus": {
            1: "elements and principles of design, KWL/log routines, foundational art vocabulary, observation, composition, and basic creative process.",
            2: "shading, portraiture, value, drawing detail, form, technique practice, critique, and reflection.",
            3: "colour theory, colour meanings, colour application, design decisions, and visual communication.",
            4: "printmaking techniques, process documentation, studio safety, image transfer, and final print evidence.",
            5: "sculpting, material exploration, clay/assemblage techniques, three-dimensional design, and construction process reflection.",
            6: "culminating self-portrait, final project planning, portfolio synthesis, and final exam preparation.",
        },
        "essential_questions": [
            "How do artists use elements and principles of design to communicate meaning?",
            "How can technique, process, and critique improve a visual artwork over time?",
            "How can students document creative decisions and use feedback to strengthen final portfolio evidence?",
        ],
        "source_note": "AVI1O teacher-prep planning is based on the localized Moodle course, indexed assignments/resources, and the official Ontario Arts Grades 9 and 10 curriculum reference.",
    },
    "AVI3M": {
        "subject": "Visual Arts",
        "grade": "Grade 11, University/College Preparation",
        "curriculum_title": "The Ontario Curriculum, Grades 11 and 12: The Arts, 2010 (Revised)",
        "curriculum_url": "https://www.publications.gov.on.ca/ontario-curriculum-grades-11-and-12-the-arts-2010-revised",
        "source_url": "local AVI3M Moodle course package",
        "course_lens": "intermediate visual arts learning through art criticism, art history, aesthetics, studio production, portfolio development, and independent study evidence.",
        "unit_focus": {
            1: "elements and principles of art, design vocabulary, diagnostic review, and foundational analysis.",
            2: "art criticism, aesthetic response, art history methods, interpretation, evidence, and critique writing.",
            3: "earliest times and ancient art, cultural context, historical inquiry, comparison, and reflective response.",
            4: "late nineteenth century and post-impressionism, landscape painting, style analysis, studio application, and critique.",
            5: "independent study project, Canadian art research, final exam review, and summative portfolio evidence.",
        },
        "essential_questions": [
            "How do artists and viewers use criticism, history, and aesthetics to interpret art?",
            "How does historical and cultural context shape artistic choices and viewer response?",
            "How can a portfolio demonstrate growth in technique, inquiry, reflection, and independent artistic voice?",
        ],
        "source_note": "AVI3M teacher-prep planning is based on the localized Moodle course, indexed course outline/files, and the official Ontario Arts Grades 11 and 12 curriculum reference.",
    },
    "BTT1O": {
        "subject": "Information and Communication Technology in Business",
        "grade": "Grade 9 or 10, Open",
        "curriculum_title": "The Ontario Curriculum, Grades 9 and 10: Business Studies, 2006 (Revised)",
        "curriculum_url": "https://www.publications.gov.on.ca/business-studies-ontario-curriculum-grades-9-10-2006-revised",
        "source_url": "local BTT1O Moodle course package",
        "course_lens": "digital literacy and business communication through web design, word processing, spreadsheets, presentation software, productivity tools, and culminating applied evidence.",
        "unit_focus": {
            1: "webpage construction, HTML/CSS basics, web communication, design conventions, and publishing evidence.",
            2: "Microsoft Word communication projects, professional document formatting, editing, layout, and business communication.",
            3: "Microsoft Excel in business, spreadsheets, formulas, tables, charts, data organization, and decision support.",
            4: "creative PowerPoint presentations, visual communication, slide design, audience, delivery, and multimedia polish.",
            5: "culminating final project, software integration, portfolio evidence, final presentation, and reflection.",
        },
        "essential_questions": [
            "How can digital tools improve the clarity and professionalism of business communication?",
            "How do spreadsheets, documents, presentations, and web pages support real business decisions and workflows?",
            "How can students demonstrate responsible, accurate, and polished use of technology across a culminating task?",
        ],
        "source_note": "BTT1O teacher-prep planning is based on the localized Moodle course, indexed assignment files, and the official Ontario Business Studies Grades 9 and 10 curriculum reference.",
        "generate_course_outline": True,
    },
}


def official_reference(course_code, course_root, manifest, profile, results):
    ensure_dir(course_root / "texts")
    source_path = course_root / "texts" / "SOURCES.md"
    existing = source_path.read_text(encoding="utf-8", errors="ignore") if source_path.exists() else ""
    block = (
        f"\n\n## Teacher-Prep Promotion {GENERATED_AT}\n\n"
        f"- Official/reference curriculum: {profile['curriculum_title']}\n"
        f"- Curriculum URL/reference: {profile['curriculum_url']}\n"
        f"- Course/source base: {profile['source_url']}\n"
        f"- Note: {profile['source_note']}\n"
    )
    if "Teacher-Prep Promotion" not in existing:
        source_path.write_text((existing or f"# {course_code} Sources and Localization Notes\n").rstrip() + block + "\n", encoding="utf-8")
        results["sourceNotesWritten"].append(source_path.relative_to(course_root).as_posix())

    manifest["texts"] = [
        item
        for item in (manifest.get("texts") or [])
        if isinstance(item, dict) and isinstance(item.get("units"), list) and isinstance(item.get("materials"), list)
    ]
    units = [int(unit.get("unit")) for unit in (manifest.get("units") or []) if unit.get("unit") is not None]

    source_item = resource_item(f"{course_code} Sources and Teacher-Prep Notes", "texts/SOURCES.md", "source_notes", "source_audit", "md", "local source audit")
    update_bytes(course_root, source_item)
    upsert(manifest["texts"], text_registry_item(course_code, f"{course_code} Sources and Teacher-Prep Notes", source_item, units, profile["source_note"]))

    ref_rel = Path("texts/ontario-curriculum") / f"{course_code.lower()}-official-curriculum-reference.md"
    ref = course_root / ref_rel
    ensure_dir(ref.parent)
    if not ref.exists():
        ref.write_text(
            f"# {profile['curriculum_title']}\n\n"
            f"Official reference: {profile['curriculum_url']}\n\n"
            "This local reference indexes the official Ontario curriculum source used for teacher preparation, alignment checks, and package QA.\n",
            encoding="utf-8",
        )
        results["copiedResources"].append({"course": course_code, "from": profile["curriculum_url"], "to": ref_rel.as_posix()})
    ref_item = resource_item(profile["curriculum_title"], ref_rel.as_posix(), "official_curriculum", "official_curriculum", "md", profile["curriculum_url"])
    update_bytes(course_root, ref_item)
    upsert(manifest["texts"], text_registry_item(course_code, profile["curriculum_title"], ref_item, units, "Official Ontario curriculum/reference indexed for teacher preparation."))

    if profile.get("generate_course_outline"):
        outline_rel = Path("plans/generated/course-outline") / f"{course_code}-course-outline-and-teacher-planning-overview.md"
        outline = course_root / outline_rel
        ensure_dir(outline.parent)
        unit_lines = []
        for unit in manifest.get("units") or []:
            lessons = [lesson for lesson in unit.get("lessons") or [] if lesson.get("planningStatus") != "unit_overview"]
            unit_lines.append(f"- Unit {unit.get('unit')}: {unit.get('title')} ({len(lessons)} lesson group(s))")
        outline.write_text(
            f"# {course_code} Course Outline and Teacher Planning Overview\n\n"
            f"Course: {profile['subject']} ({profile['grade']})\n\n"
            f"Curriculum reference: {profile['curriculum_title']}\n\n"
            f"Official reference: {profile['curriculum_url']}\n\n"
            "## Course Lens\n\n"
            f"{profile['course_lens']}\n\n"
            "## Unit Sequence\n\n"
            + "\n".join(unit_lines)
            + "\n\n## Essential Questions\n\n"
            + "\n".join(f"- {question}" for question in profile["essential_questions"])
            + "\n\n## Teacher Use\n\n"
            "- Use this overview with the generated unit and lesson plans.\n"
            "- Confirm local files, page display, and playable resources before upload.\n"
            "- Keep ordinary files attached to their owning Moodle page; only localized H5P/video/iSpring should stand alone as playable resources.\n",
            encoding="utf-8",
        )
        outline_item = resource_item(
            f"{course_code} Course Outline and Teacher Planning Overview",
            outline_rel.as_posix(),
            "course_outline",
            "course_outline",
            "md",
            "locally generated from course manifest and official curriculum reference",
        )
        update_bytes(course_root, outline_item)
        manifest.setdefault("courseDownloads", [])
        upsert(manifest["courseDownloads"], outline_item)
        upsert(manifest["texts"], text_registry_item(course_code, outline_item["label"], outline_item, units, "Generated course outline and teacher planning overview indexed for teacher preparation."))
        results["copiedResources"].append({"course": course_code, "from": "generated local course manifest", "to": outline_rel.as_posix()})


def promote(course_code):
    profile = PROFILES[course_code]
    course_root = COURSEWARE_ROOT / course_code
    manifest_path = course_root / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    results = {
        "course": course_code,
        "unitPlansCreated": [],
        "lessonPlansCreated": [],
        "sourceNotesWritten": [],
        "copiedResources": [],
    }
    official_reference(course_code, course_root, manifest, profile, results)

    for unit in manifest.get("units") or []:
        unit_no = int(unit.get("unit"))
        if not unit.get("unitPlan") or not item_exists(course_root, unit.get("unitPlan")) or not generated_plan_path(unit.get("unitPlan"), "unit-plans"):
            out_dir = course_root / "plans" / "generated" / "unit-plans"
            ensure_dir(out_dir)
            out = out_dir / f"{course_code}-U{unit_no:02d}-unit-plan.docx"
            create_unit_doc(course_code, course_root, unit, profile, out)
            item = plan_item(f"{course_code} Unit {unit_no} Teacher Unit Plan", rel(out, course_root), "unit_plan")
            update_bytes(course_root, item)
            unit["unitPlan"] = item
            results["unitPlansCreated"].append(item["path"])

        for lesson in unit.get("lessons") or []:
            if lesson.get("planningStatus") == "unit_overview":
                continue
            if lesson.get("lessonPlan") and item_exists(course_root, lesson.get("lessonPlan")) and generated_plan_path(lesson.get("lessonPlan"), "lesson-plans"):
                continue
            lesson_no = int(lesson.get("lesson"))
            out_dir = course_root / "plans" / "generated" / "lesson-plans" / f"Unit-{unit_no:02d}"
            ensure_dir(out_dir)
            out = out_dir / f"{course_code}-U{unit_no:02d}-L{lesson_no:02d}-{slug(lesson.get('title'))}-lesson-plan.docx"
            create_lesson_doc(course_code, course_root, unit, lesson, profile, out)
            item = plan_item(f"{course_code} U{unit_no}L{lesson_no} Teacher Lesson Plan - {lesson.get('title')}", rel(out, course_root), "lesson_plan")
            update_bytes(course_root, item)
            lesson["lessonPlan"] = item
            results["lessonPlansCreated"].append(item["path"])

    manifest.setdefault("sourceAudit", {})
    manifest["sourceAudit"]["teacherPrepPromotion"] = {
        "promotedAt": GENERATED_AT,
        "standard": "ICS3U teacher-prep enrichment; ENG3U display conventions",
        "course": course_code,
        "unitPlansCreated": len(results["unitPlansCreated"]),
        "lessonPlansCreated": len(results["lessonPlansCreated"]),
    }
    manifest["generatedAt"] = GENERATED_AT
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return results


def main():
    results = [promote(code) for code in ("AVI1O", "AVI3M", "BTT1O")]
    output = {"generatedAt": GENERATED_AT, "results": results}
    ensure_dir(REPORT_PATH.parent)
    REPORT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
