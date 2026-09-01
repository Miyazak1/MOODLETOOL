# OSSD Course Package Standard

Updated: 2026-08-25

This document defines the stable course production standard for the OSSD Course
Portal. It exists to stop course fixes from changing frontend behavior, package
shape, or resource placement unpredictably.

The standard is not copied from one course. It is a shared course model with
reference courses for different concerns.

## 1. Reference Courses

Use these courses as references for different layers of the system:

| Concern | Reference course | How to use it |
| --- | --- | --- |
| Frontend display | ENG3U | Primary display standard. Page layout, H5P/video/iSpring cards, text reading width, external activity fallback, and resource-card behavior should follow ENG3U. |
| New Moodle structure | MDM4U | Section 0, Course Resources, Unit Roadmap, and new-site source structure reference only. MDM4U is not the current display standard. |
| Legacy Moodle structure | BBI2O | Old-site activity organization, URL/page text recovery, video placement, and legacy attachment behavior reference. |
| Science/interactive stress test | SNC2D, SBI4U | Mixed video/H5P/iSpring/consolidation/homework/dropbox scenarios. Use these for regression checks. |
| New crawl production sample | ICS3U | Full crawler -> normalizer -> package -> frontend -> online comparison workflow reference. |

Do not blindly copy one reference course into another course. First identify the
source family and source Moodle evidence, then normalize into the shared model.

## 2. Core Principle

All courses must pass through the same four layers:

1. Raw crawl layer: preserve source Moodle evidence as much as possible.
2. Normalized manifest layer: convert new site, old site, section 0, books,
   pages, URLs, assignments, H5P, video, and iSpring into one stable manifest
   shape.
3. Package layer: package only from the normalized manifest and fixed path
   rules.
4. Frontend layer: render only from manifest fields. The frontend must not guess
   resource roles from filenames, paths, or course-specific exceptions.

If a fix is needed, prefer fixing crawl, localization, normalization, package
generation, or validation. Avoid course-specific frontend exceptions.

## 3. Stable Package Shape

Every uploadable package must use the current fixed-root upload shape: the zip
root directly contains `course-manifest.json`. Do not wrap the payload in an
extra `<COURSE_CODE>/` directory because the current uploader/extractor expects
the manifest at zip root.

```text
course-manifest.json
package-manifest.json
validation-report.json
course-sections/
Unit 1/
Unit 2/
ispring-localized/
localized-moodle/
teacher-prep/
texts/
source-audit/
```

Existing courses may still contain legacy-compatible paths such as
`Unit 1/Lesson 1 - .../book_sections/...`, but the manifest must expose the same
normalized semantics. The frontend should not depend on legacy folder names when
a manifest field exists.

## 4. Manifest Contract

Each playable or downloadable resource must have stable semantics:

```json
{
  "id": "ICS3U-U01-L01-HANDS_ON-H5P-0740",
  "course": "ICS3U",
  "unit": 1,
  "lesson": 1,
  "role": "hands_on",
  "type": "h5p",
  "category": "localized_external_h5p",
  "label": "H5P - ICS3U Unit 1 Lesson 1 Hands On Activity 740",
  "display": {
    "embedInPage": true,
    "standaloneCard": true
  },
  "source": {
    "kind": "moodle",
    "activityId": 740,
    "originalUrl": "https://..."
  },
  "paths": {
    "preview": "localized-moodle/h5p-external/0740-title/index.html",
    "download": "localized-moodle/h5p-external/0740-title.h5p"
  },
  "status": {
    "localized": true,
    "exists": true,
    "httpOk": true
  }
}
```

The exact current `course-manifest.json` schema may use older field names such
as `previewPath`, `path`, `role`, `type`, and `category`. New scripts should
move toward the explicit `display`, `paths`, and `status` contract without
breaking existing courses.

## 5. Display Rules

These rules are shared across all courses.

### 5.1 Standalone Resource Cards

If a resource is localized and playable, it must appear both where Moodle placed
it and as a standalone card in the owning course section:

| Type | Page body | Standalone card | Notes |
| --- | --- | --- | --- |
| H5P | Yes, when Moodle embedded it in the page | Yes | Applies to Hands On, Consolidation, lesson, and other owning roles. |
| Video | Yes, when Moodle embedded it in the page | Yes | Standalone video page must play directly, without manual "Load video" gate. |
| iSpring | Usually standalone playable | Yes | Must have a direct "Play courseware" action. |
| PDF/DOC/DOCX/PPT/XLS | Attachment only | No | These files stay mounted under their owning page/card attachments. They are not separate cards unless Moodle itself created a separate activity page. |

Do not hide ordinary documents. "No standalone card" means no separate resource
card, not no attachment row.

### 5.2 Activity Page Attachments

HTML/page/url/assign activities must retain body text and mounted attachments.
If a Moodle activity has both body text and files, both must remain visible.

### 5.3 External Activities

External SaaS activities that cannot be localized safely should use the ENG3U
external activity fallback style: a clear local page with a direct open-in-new-tab
action. Do not invent a fake local H5P package.

### 5.4 Reading Texts

Long texts should use the ENG3U reading style:

1. readable max width, not narrow columns;
2. stable paragraph spacing;
3. downloadable DOCX/PDF when legally allowed and useful;
4. source/copyright notes recorded in the text index or source audit.

## 6. Course Structure Rules

### 6.1 Course Resources

`Course Resources` is a container, not a content target. It should not be used as
a right-side quick navigation tick.

Specific visible groups under Course Resources are content targets and may be
quick-navigation ticks, for example:

1. Introduction
2. Course Overview
3. Teacher Packet
4. Homework Submission Folder
5. Final Examination & Culminating
6. Textbook / Curriculum / Text index groups

### 6.2 Unit Roadmap

`Unit Roadmap` is a unit switching control, not a content target. It should not
be used as a right-side quick navigation tick.

### 6.3 Units and Lessons

The right-side quick navigation should navigate to the current visible Unit as a
large block. It should not generate lesson-level ticks because lessons are often
collapsed or hidden by the selected Unit state.

Lesson rows still need stable DOM ids for direct links and debugging, but they
are not part of the global quick navigation.

### 6.4 New Site Section 0

New Moodle courses may have section 0. Preserve it as course-level resources,
usually Introduction or Course Overview. Do not merge it into Unit 1 unless the
source Moodle evidence proves that section 0 is actually Unit 1 content.

### 6.5 Old Site Compatibility

Legacy old-site courses should be normalized into the same role model:

1. lesson flow: Lesson Expectations, Lesson, Hands On, Consolidation, Homework;
2. course-level groups: Course Overview, Homework Submission Folder, Teacher
   Packet, Final Examination & Culminating;
3. media: H5P/video/iSpring localized and carded when available;
4. documents: attached to the owning page/activity.

## 7. Self-Check Rules

Every course should be checked before packaging.

### 7.1 Crawl Completeness

Detect:

1. Moodle activities with body text but empty local HTML;
2. URL/page activities reduced to "Moodle activity not indexed";
3. book sections missing from lesson flow;
4. section 0 missing in new-site courses;
5. source activities present in Moodle navigation but absent from manifest.

### 7.2 Localization Coverage

Detect:

1. H5P embedded in a page but missing a standalone localized card;
2. standalone H5P card with missing preview file;
3. video embedded in a page but missing a standalone playable card;
4. iSpring listed without a direct play action;
5. localized playable resource whose HTTP path returns 404;
6. external links that should have been localized.

### 7.3 File Placement and Misalignment

Detect:

1. answer pages paired with the wrong lesson/dropbox;
2. Homework Submission Folder answer/dropbox count mismatches;
3. PDF/DOCX/PPT shown as standalone cards when they should be attachments;
4. attachments mounted to the wrong activity page;
5. duplicate resources caused by both page attachment and standalone file logic.

### 7.4 Frontend Display Stability

Detect:

1. lesson-flow pages not using the ENG3U shell (`page-title`,
   `moodle-section`, `moodle-content`, and `course-page-shell.css`);
2. legacy page wrappers left in lesson-flow pages, including inline `<style>`,
   `article.content`, `generalbox`, or `book_content`;
3. videos not centered in ENG3U display style;
4. long text pages with overly narrow reading columns;
5. external fallback cards using broken inline formatting;
6. standalone playable cards missing the primary action;
7. right-side quick navigation containing non-content containers or collapsed
   lesson targets.

## 8. QA Commands

The Course QA Workbench should grow around these commands. `qa:course` has a
first implementation; the package and online checks are the next stages.

```bash
npm run qa:course -- --course <COURSE>
npm run qa:structure -- --course <COURSE>
npm run qa:structure -- --course <COURSE> --markdown
npm run qa:package -- --course <COURSE>
npm run qa:package -- --course <COURSE> --zip deployment/course-packages/<COURSE>-course-package.zip
npm run qa:online -- --course <COURSE> --url https://www.moodletool.work
npm run qa:online -- --course <COURSE> --url https://www.moodletool.work --username <USER> --password <PASS>
npm run qa:gate -- --course <COURSE>
npm run qa:gate -- --course <COURSE> --zip deployment/course-packages/<COURSE>-course-package.zip
npm run qa:gate -- --course <COURSE> --zip deployment/course-packages/<COURSE>-course-package.zip --url https://www.moodletool.work --username <USER> --password <PASS>
npm run smoke:table-course-scope
npm run qa:table
npm run qa:table -- --checked-only
npm run audit:table-packages
npm run audit:teacher-prep -- --course <COURSE>
npm run package:table -- --limit 3
npm run package:table -- --limit 3 --apply
npm run package:course -- --course <COURSE>
npm run package:course -- --course <COURSE> --dry-run
npm run package:course -- --course <COURSE> --online-url https://www.moodletool.work --username <USER> --password <PASS>
```

Expected responsibilities:

| Command | Purpose |
| --- | --- |
| `qa:course` | Local manifest and source-structure audit before packaging. First version implemented in `scripts/qa-course.mjs`. |
| `qa:structure` | Course structure review mode: writes JSON and Markdown reports grouped by Course Resources, Unit, Lesson, and lesson-flow section. It is designed for crawl/recovery review and AI-assisted inspection. First version implemented in `scripts/review-course-structure.mjs`. |
| `qa:package` | Package preflight: required files, HTML dependencies, fixed-root zip shape, and zip/local manifest drift. First version implemented in `scripts/qa-package.mjs`. |
| `qa:online` | AI-facing local-vs-online comparison: manifest hash, bundle hash, resource path status, and sampled local/online resource mismatches. First version implemented in `scripts/qa-online.mjs`. |
| `qa:gate` | Unified gate that runs `qa:course`, `qa:package`, and optionally `qa:online`, then writes one combined report. First version implemented in `scripts/qa-gate.mjs`. |
| `smoke:table-course-scope` | Read-only guard that checks the hard-coded table scope still matches `洛阳一中教材列表.xlsx`, including the default `BBI2O` skip and checked-only set. |
| `qa:table` | Table-scoped QA for `洛阳一中教材列表.xlsx`: runs only the courses listed in that table, excludes `NONE`, and skips `BBI2O` by default because it was explicitly removed from the current checking scope. |
| `audit:table-packages` | Read-only package freshness audit for the same table-scoped courses: reports missing zip packages and packages older than local course files. |
| `audit:teacher-prep` | Teacher-prep readiness audit based on the ICS3U preparation sample: curriculum guidance, course plan, unit plans, lesson plans, source audit, text references, teacher resources, and missing local paths. |
| `package:table` | Table-scoped packaging coordinator. Without `--apply`, it prints the next package commands only; with `--apply`, it runs `package:course` sequentially. Use `--limit 3` or a smaller limit when disk space is tight. |
| `package:course` | Safe package pipeline: run pre-package course QA, delete old course package zips, build a fixed-root zip, then run post-package gate against the new zip. First version implemented in `scripts/package-course-with-qa.mjs`. |

The online comparison output should be machine-readable JSON first. It is mainly
for AI-assisted diagnosis, not for human-facing UI.

Use `qa:table` for the current Luoyang No. 1 course-production scope. Do not use
`qa:all-courses` as the default production gate for this project because local
courseware may contain incomplete, out-of-table, or experimental course folders.
`qa:table` fails on either `FAIL` or `REVIEW` by default; pass
`--allow-review` only when a warning has been inspected and accepted.
`audit:table-packages` exits non-zero when any table-scoped course is missing a
zip package or has a zip older than the local course files; that exit code means
"rebuild needed", not that the audit crashed.

## 8.1 Structure Review Mode

`qa:structure` is the standard inspection command after crawling or repairing a
course. It does not replace `qa:course`; it presents the same kind of evidence in
a course-shaped review:

1. Course resource sections, including section pages and course-level downloads.
2. Unit summary, unit plan presence, and unit resource counts.
3. Lesson rows with section count, localized H5P/video/iSpring counts, and
   ordinary document counts.
4. Book-section flow review for Lesson, Hands On, Consolidation, and Homework.
5. Embedded playable resources that do not have same-flow standalone cards.
6. Placeholders, thin pages, and missing local section paths.

The command auto-detects `lesson-flow` courses when lessons have Moodle book
sections. Courses without book sections are treated as `legacy`, so reference
courses such as BBI2O are not incorrectly forced through new-site lesson-flow
rules. Use `--profile lesson-flow` or `--profile legacy` only when the automatic
choice is wrong.

## 8.2 Teacher Prep Pack Standard

ICS3U is the current teacher-prep reference sample. Its value is not a visual
style; it is the preparation depth expected for a teacher using a course after
upload. Promote that model across courses by checking and filling the following
resource groups:

1. official curriculum guidance for the course code and grade;
2. a course outline or course plan that explains pacing and assessment shape;
3. one unit plan for each instructional unit;
4. one lesson plan for each lesson that is not an intentional unit overview;
5. a source audit or source note file recording textbook/source decisions;
6. textbook, literature, curriculum, or supplemental text references where
   legally available;
7. teacher-facing resources such as answers, rubrics, quizzes, tests, labs,
   evaluation pages, and teacher packets;
8. local paths that package cleanly with the course.

Do not copy ICS3U content into another course. Use ICS3U as a completeness
model, then derive the actual teacher-prep materials from the target course's
Moodle evidence, official curriculum, legal textbook/text sources, and existing
course files.

The teacher-prep audit is evidence-first. It reports gaps before making course
content changes:

```bash
npm run audit:teacher-prep -- --course ICS3U
npm run audit:teacher-prep -- --course SBI4U
npm run audit:teacher-prep
```

The command writes:

1. `deployment/<COURSE>-teacher-prep-audit.json`
2. `deployment/<COURSE>-teacher-prep-audit.md`
3. `deployment/teacher-prep-audit-summary.json` for all-course runs
4. `deployment/teacher-prep-audit-summary.md` for all-course runs

Treat `audit:teacher-prep` as a planning gate, not a display repair. It should
not change course pages, localized H5P/video/iSpring behavior, or attachment
placement. When it finds gaps, repair the relevant manifest/source files first,
then run `qa:course`, `qa:structure`, `qa:display`, and `package:course` as
appropriate.

## 9. Packaging Gate

A course should not be uploaded until the package gate passes:

1. Zip root contains `course-manifest.json`.
2. The package is not nested under an extra `<COURSE>/` directory.
3. Manifest course code matches the selected course.
4. All manifest `previewPath` and `path` references exist inside the package or
   are explicitly CDN/remote references.
5. Localized H5P/video/iSpring resources have standalone cards according to the
   display rules.
6. Ordinary documents remain attached to owning activity pages.
7. Homework Submission Folder answer/dropbox pairing has been checked.
8. `validation-report.json` records warnings and accepted source exceptions.

The recommended packaging command is:

```bash
npm run audit:table-packages
npm run package:table -- --limit 3
npm run package:course -- --course <COURSE>
```

This command intentionally deletes previous `<COURSE>-course-package*.zip` files
from `deployment/course-packages/` before creating the new package. Use
`--keep-old-packages` only when comparing historical packages. Use `--dry-run`
to inspect the plan without deleting or creating zip files; dry-run reports
planned deletions separately from actual deletions.

For multiple table-scoped courses, run `package:table` in plan mode first:

```bash
npm run package:table -- --limit 3
npm run package:table -- --limit 3 --apply
```

`package:table` never packages more than the selected limit. It packages only
missing or stale table-scoped course zips unless `--all` is supplied. In apply
mode it refuses to run without `--limit` unless `--force-all` is explicitly
supplied; this protects low-disk servers from accidental full-table package
builds.

## 10. Exception Policy

Course-specific exceptions are allowed, but they must be documented with source
evidence. An exception record should include:

1. course code;
2. source Moodle URL or activity id;
3. affected unit/lesson/section;
4. expected standard behavior;
5. reason for exception;
6. whether the exception is display-only, package-only, or source-data-only.

Do not use an exception to hide a crawler or packaging bug.
