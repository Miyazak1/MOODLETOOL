import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from promote_teacher_prep_avi_btt import official_reference  # noqa: E402
from promote_teacher_prep_hhs_lkb_bbi1 import (  # noqa: E402
    COURSEWARE_ROOT,
    GENERATED_AT,
    REPO_ROOT,
    create_lesson_doc,
    create_unit_doc,
    ensure_dir,
    generated_plan_path,
    item_exists,
    plan_item,
    rel,
    slug,
    update_bytes,
)


REPORT_PATH = REPO_ROOT / "deployment" / "teacher-prep-promotion-ICS4U-MTH1W-PPL.json"


PROFILES = {
    "ICS4U": {
        "subject": "Computer Science",
        "grade": "Grade 12, University Preparation",
        "curriculum_title": "The Ontario Curriculum, Grades 10 to 12: Computer Studies, 2008 (Revised)",
        "curriculum_url": "https://www.edu.gov.on.ca/eng/curriculum/secondary/computer10to12_2008.pdf",
        "source_url": "local ICS4U Moodle course package",
        "course_lens": "advanced computer science through modular programming, object-oriented design, algorithms, software engineering, ethical computing, and a team-based software development cycle.",
        "unit_focus": {
            1: "programming concept review, code reading, debugging habits, modular design, data structures, and disciplined implementation routines.",
            2: "object-oriented programming, class design, encapsulation, inheritance, polymorphism, documentation, and reusable software components.",
            3: "algorithm design and analysis, recursion, searching, sorting, efficiency, problem decomposition, and evidence-based comparison.",
            4: "software development life cycle, requirements, project planning, version/process discipline, testing, review, ethics, and final team project evidence.",
        },
        "essential_questions": [
            "How do professional programmers design reliable, readable, and maintainable software?",
            "How can object-oriented design and algorithm analysis improve the quality of a solution?",
            "How can a software team manage requirements, implementation, testing, and ethical decisions across a complete project?",
        ],
        "source_note": "ICS4U teacher-prep planning is based on the localized Moodle course, indexed course outline/files, and the official Ontario Computer Studies Grades 10 to 12 curriculum reference.",
        "generate_course_outline": True,
    },
    "MTH1W": {
        "subject": "Mathematics",
        "grade": "Grade 9, De-streamed",
        "curriculum_title": "Ontario Curriculum Mathematics: Grade 9, De-Streamed (MTH1W), 2021",
        "curriculum_url": "https://www.dcp.edu.gov.on.ca/en/curriculum/secondary-mathematics/courses/mth1w",
        "source_url": "local MTH1W Moodle course package",
        "course_lens": "de-streamed Grade 9 mathematics through mathematical thinking, number sense, algebra, data, geometry, measurement, coding, financial literacy, modelling, and real-life applications.",
        "unit_focus": {
            1: "number sense, integers, fractions, proportional reasoning, estimation, fluency, and learning-log routines.",
            2: "algebraic thinking, monomials, expressions, equations, relationships, and multiple representations.",
            3: "data literacy, graphing, data collection, interpretation, claims, and communication of evidence.",
            4: "geometry and measurement, spatial reasoning, transformations, measurement relationships, and problem solving.",
            5: "coding with Python, algorithmic thinking, computational representations, debugging, and mathematical modelling.",
            6: "financial literacy, earning/spending/saving decisions, percentages, interest, budgets, and applied personal finance.",
        },
        "essential_questions": [
            "How can students use multiple representations to make sense of mathematical relationships?",
            "How do number, algebra, data, geometry, coding, and financial literacy connect to decisions in real contexts?",
            "How can students explain mathematical thinking clearly and use feedback to improve problem-solving strategies?",
        ],
        "source_note": "MTH1W teacher-prep planning is based on the localized Moodle course, indexed course files, and the official Ontario Grade 9 de-streamed mathematics curriculum reference.",
        "generate_course_outline": True,
    },
    "PPL1O": {
        "subject": "Healthy Active Living Education",
        "grade": "Grade 9, Open",
        "curriculum_title": "The Ontario Curriculum, Grades 9-12: Health and Physical Education, 2015",
        "curriculum_url": "https://www.publications.gov.on.ca/browse-catalogues/health-physical-education-curriculum/secondary/the-ontario-curriculum-grades-9-12-health-and-physical-education-2015",
        "source_url": "local PPL1O Moodle course package",
        "course_lens": "healthy active living through physical literacy, movement competence, active living, personal safety, mental health, substance-use awareness, relationships, and responsible decision making.",
        "unit_focus": {
            1: "active living, health and nutrition, physical activity, fitness habits, goal setting, and personal wellness reflection.",
            2: "safety, abuse and trauma awareness, bullying/cyberbullying, substance-use risk, protective factors, and help-seeking strategies.",
            3: "healthy living, sexual health, mental health, stress, relationships, consent, and responsible personal decision making.",
            4: "movement competence, fundamental movement skills, movement development, safety, strategy, and transfer across activity contexts.",
        },
        "essential_questions": [
            "How can students build habits that support lifelong healthy active living?",
            "How do safety, relationships, mental health, and decision-making skills affect well-being?",
            "How can movement competence and personal reflection help students participate with confidence and responsibility?",
        ],
        "source_note": "PPL1O teacher-prep planning is based on the localized Moodle course, indexed course files, and the official Ontario Health and Physical Education Grades 9 to 12 curriculum reference.",
        "generate_course_outline": True,
    },
    "PPL3O": {
        "subject": "Healthy Active Living Education",
        "grade": "Grade 11, Open",
        "curriculum_title": "The Ontario Curriculum, Grades 9-12: Health and Physical Education, 2015",
        "curriculum_url": "https://www.publications.gov.on.ca/browse-catalogues/health-physical-education-curriculum/secondary/the-ontario-curriculum-grades-9-12-health-and-physical-education-2015",
        "source_url": "local PPL3O Moodle course package",
        "course_lens": "senior healthy active living through health growth, exercise, mental health, sexuality, risk management, decision making, and responsible personal/community wellness.",
        "unit_focus": {
            1: "health, healthy active living, exercise, body systems, fitness concepts, and personal wellness planning.",
            2: "health growth and sexuality, reproductive health, infertility, relationships, consent, and respectful decision making.",
            3: "mental health, stress management, defence mechanisms, coping strategies, stigma, support networks, and resilience.",
            4: "safety, accidents and risks, drug use, substance-related decision making, prevention, and responsible action.",
        },
        "essential_questions": [
            "How can students make informed choices that support lifelong physical, mental, and social well-being?",
            "How do exercise, sexuality, mental health, and substance-use decisions connect to personal safety and community responsibility?",
            "How can students use reliable information, reflection, and support networks to manage health-related risks?",
        ],
        "source_note": "PPL3O teacher-prep planning is based on the localized Moodle course, recorded-class resources, and the official Ontario Health and Physical Education Grades 9 to 12 curriculum reference.",
        "generate_course_outline": True,
    },
}


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
    results = [promote(code) for code in ("ICS4U", "MTH1W", "PPL1O", "PPL3O")]
    output = {"generatedAt": GENERATED_AT, "results": results}
    ensure_dir(REPORT_PATH.parent)
    REPORT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
