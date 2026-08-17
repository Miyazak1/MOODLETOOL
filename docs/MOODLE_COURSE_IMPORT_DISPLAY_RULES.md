# Moodle Course Import and Display Rules

Updated: 2026-08-17

This document is the canonical rule set for importing Moodle courses into the
OSSD Course Portal. It captures the lessons learned from BAF3M, BAT4M, ENG2D,
ENG3U, ENG4U, MCR3U, MDM4U, OLC4O, SES4U, and similar St.Mary/New Moodle
courses.

The goal is to avoid course-specific frontend exceptions. Fixes should be made
in import, localization, repair, manifest generation, or storage/indexing
scripts so the same course shape works consistently across local and production.

## 1. Core Principles

1. Preserve teaching context first. If Moodle has meaningful text, keep it as an
   HTML page that can be opened with "view".
2. Do not flatten a text-bearing Moodle activity into a plain file card.
3. Media should be shown in two places when the original lesson has context:
   embedded in the HTML body and also as a standalone playable resource card.
4. Do not decide OSS/CDN placement by ZIP size alone. Decide by resource type
   and role.
5. Do not treat `/courseware/...` or `/embed/...` in the address bar as proof
   that media is not on CDN. Inspect the actual media/resource URLs.
6. Avoid per-course frontend special cases. Course-specific normalization is
   allowed only when it produces the standard manifest/HTML shape described
   here.

## 2. Course Overview and Course Resources

Course-level pages and resources should be organized as teaching context, not as
a flat file dump.

### 2.1 Course Overview

Use a Course Overview section when Moodle provides an overview book/page or
equivalent course introduction. The overview may include text, attachments,
iSpring, H5P, or video.

Expected shape:

```text
courseware/<COURSE>/course-sections/course-overview/index.html
```

Rules:

1. Keep the overview HTML page if it contains meaningful text.
2. If the overview contains iSpring/H5P/video, embed that media inside the HTML
   page.
3. Also expose playable media as separate manifest entries where useful.
4. Do not leave iSpring referenced through stale nested paths such as
   `course-sections/course-overview/ispring-localized/...` if the published
   package is really at `<COURSE>/ispring-localized/...`.
5. Course Overview iSpring must pass the same language-pack check as lesson
   iSpring. Literal button labels such as `Roll.Player.Continue`,
   `Roll.Player.Complete`, or `Roll.Player.GotoNextChapterLink` are a broken
   iSpring/Roll i18n package, even when the presentation itself appears to play.

### 2.2 Course Outline, Learning Log, and Similar Resources

Resources such as Course Outline, Learning Log, syllabus pages, welcome pages,
and course-level handouts follow these rules:

1. If Moodle has body text plus attachments, create an activity HTML card. The
   card "view" action opens the HTML page, and attachments are listed in or
   below the card.
2. If the source is only a single file and has no meaningful body text, flatten
   it to a file card.
3. If a course-level resource is both a text page and a downloadable file, keep
   both: the page provides context, and the file remains downloadable.
4. Learning Log is a mandatory attachment-aware resource. If Moodle text says a
   sample/template/log is attached, the localized HTML page must list that
   DOCX/PDF/XLSX attachment and the manifest must expose it through `path`,
   `previewPath`, `downloadPath`, or an attachment record.
5. Do not mark a Learning Log or Reflection page as complete when only the
   paragraph text was localized. The attached student template, sample, or
   tracking document is part of the teaching resource.
6. If a Moodle course activity explicitly attaches a file whose internal content
   appears to belong to another course, do not silently substitute a file from a
   different course and do not drop the Moodle attachment from the student view.
   Keep the source attachment, record the mismatch in `sourceAudit`, and report
   it as a source-content issue. Only replace it when a verified same-course
   source file is found.

## 3. Unit and Lesson Structure

The portal is unit-first and lesson-first. Files should be attached to their
teaching location whenever that can be inferred.

Recommended lesson shape:

```text
Unit
  Unit Overview
  Unit Plan
  Lessons
    Lesson
      Lesson Plan / Teacher Packet
      Lesson Expectations
      Lesson
      Hands On
      Consolidation
      Homework
      Files / Activities
      Evaluation / AOL when applicable
```

Rules:

1. Moodle book sections are lesson content, not generic files.
2. Preserve `Lesson Expectations`, `Lesson`, `Hands On`, `Consolidation`, and
   `Homework` as HTML entries when they contain body text.
3. Do not hide a Moodle book section because it looks like a shell. If it has a
   path, previewPath, downloadPath, URL, attachments, or meaningful text, it is
   teacher-visible.
4. Lesson plans and teacher packets should appear at the top of the lesson or in
   a teacher-prep area, not mixed into student-facing files.

## 4. Moodle Book Section HTML

Book section HTML pages are the source of truth for lesson text. This rule
applies to old Moodle exports and new St.Mary/New Moodle courses.

### 4.1 Section Mapping

Use the original Moodle section label when possible:

| Moodle label | Portal section |
| --- | --- |
| Lesson Expectations | Lesson Expectations |
| Lesson | Lesson |
| Hands On | Hands On |
| Consolidation | Consolidation |
| Homework | Homework |

If labels vary by capitalization or punctuation, normalize conservatively. Do
not infer a section from file order alone unless the Moodle book order is the
only reliable signal.

### 4.2 Embedded Media in Book Sections

If a book section references iSpring, H5P, or video, the media must be embedded
inside the HTML body as well as exposed as a standalone resource.

Insertion order:

1. Replace an existing Moodle iframe when it points to the same media.
2. Replace a known placeholder such as:

```html
<div class="portal-note">Interactive media pending local package; external playback was not embedded.</div>
```

3. If no iframe or placeholder exists, insert the media block before
   `</article>`.
4. If a Files block is inside the same article, insert before that Files block.
   In most exported pages, Files are separate cards, so `</article>` is the safe
   default.

Do not add download buttons inside the HTML body. Standalone media cards provide
play/share/shortcode actions.

### 4.3 iSpring Embed Markup

Use a wrapper for book-section iSpring embeds:

```html
<div class="localized-ispring">
  <iframe
    src="../../../ispring-localized/unit-01/U01L01/presentation.html"
    width="1500"
    height="600"
    frameborder="0"
    scrolling="auto"
    allowfullscreen="allowfullscreen"
    loading="lazy"
    title="Lesson - Lesson 1: Functions"></iframe>
</div>
```

Rules:

1. Compute `src` as a relative path from the book section HTML file to the
   localized iSpring `presentation.html`.
2. Do not hardcode CDN URLs into local book section HTML.
3. Skip insertion if the page already contains `ispring-localized`,
   `localized-ispring`, or `ispring-player`.
4. Insert only when the current lesson maps to exactly one iSpring package, or
   when the source iframe makes the target unambiguous.

### 4.4 H5P and Video Embed Markup

H5P and videos follow the same embedding rule:

```html
<div class="embedded-h5p-frame">
  <iframe src="..." loading="lazy" allowfullscreen="allowfullscreen"></iframe>
</div>
```

```html
<div class="embedded-video">
  <video controls preload="metadata">
    <source src="..." type="video/mp4">
  </video>
</div>
```

If a video or H5P was part of the original lesson instructions, it should remain
visible in the HTML page. The standalone card is not a replacement for the
lesson body embed.

### 4.5 Shared Embed CSS

Use centered, responsive media blocks:

```css
.localized-ispring,
.embedded-h5p-frame,
.embedded-video {
  display: block;
  margin: 16px auto 24px;
  max-width: 100%;
  width: 100%;
}

.localized-ispring iframe,
.embedded-h5p-frame iframe {
  border: 0;
  display: block;
  min-height: 640px;
  width: 100%;
}

.localized-ispring iframe {
  height: min(72vh, 760px);
}

.embedded-video video {
  background: #000;
  display: block;
  margin: 0 auto;
  max-height: min(72vh, 760px);
  max-width: 100%;
  width: min(100%, 960px);
}
```

## 5. Moodle Activities, Assignments, Pages, and Folders

Activities may have body text, attachments, submission behavior, or all three.
Preserve that distinction.

### 5.1 Text Plus Attachments

For `assign`, `page`, `folder`, `resource`, and similar Moodle activities:

1. If the activity has meaningful body text, the card "view" action opens the
   activity HTML.
2. Attachments should be listed below the card or inside the HTML page.
3. The activity should not disappear when the first attachment is missing if the
   activity body is valid.
4. If the body text references an attachment with words such as "attached",
   "sample", "template", "worksheet", "log", "outline", or "rubric", confirm
   that the corresponding material exists locally and is connected in the
   manifest.
5. Learning Log and Reflection activities are not text-only unless the Moodle
   source truly has no files. They commonly contain downloadable DOCX/PDF
   tracking forms and must be audited as text plus attachments.

### 5.2 Attachment Rows, View, Download, and Deduplication

Attachment rows must make a clear distinction between previewing and
downloading.

Rules:

1. `View` opens `previewPath` when it exists. For DOCX/PPTX/XLSX and similar
   Office files, this should be an HTML preview under `previews-html/...`.
2. `Download` opens `downloadPath` or `path` and must preserve the original file.
3. Do not point `View` at a raw Office document when an HTML preview exists,
   because browsers commonly download Office files instead of displaying them.
4. When Moodle exposes the same file more than once, for example with identical
   filename, size, and content hash but different `?time=` query strings, show it
   once. Keep one physical file, one manifest item, and one Files row.
5. Deduplicate within the same teaching context or Moodle chapter. Do not merge
   same-named files across different units, lessons, or chapters unless their
   source intent is known to be shared.
6. If page body links such as `HERE` point to a downloadable attachment and the
   page also has a Files section, the Files section is still required. The
   explicit Files row provides the separate `View` and `Download` actions.

### 5.3 Single File Resources

Flatten to a single file card only when:

1. There is one useful file.
2. The activity body is empty or only Moodle chrome.
3. No teacher/student instructions would be lost.

### 5.4 Submission and Student-Only Activities

For dropboxes, quizzes, and student submission activities:

1. Keep the instructions text.
2. Do not pretend the portal can perform the original Moodle submission action.
3. Use a neutral notice when the live student submission feature is omitted.
4. Keep any teacher-use attachments or instructions.

## 6. Texts, Materials, and Literary Works

Text/material cards should distinguish between core texts, Moodle resources,
public-domain text imports, and teacher files.

Rules:

1. A text entry may have multiple materials, such as a `.txt` public-domain text
   and a Moodle PDF resource.
2. Do not hide a text card just because one material is missing, if another
   material exists.
3. Material buttons should be generated from actual `path`, `previewPath`,
   `downloadPath`, or trusted `url` fields.
4. Public-domain and copyright status should remain visible where known.
5. Text import patches should update the manifest, not rely on frontend title
   matching.

## 7. Evaluation, AOL, KWL, Reflection, Answer Keys, and Teacher Materials

Use teaching intent and Moodle location together.

| Source item | Preferred portal location |
| --- | --- |
| Unit Assignment, Quiz, Test, Exam Review, Culminating | Evaluation / AOL |
| Homework dropbox | Homework or lesson activity, with submission note |
| KWL | Unit support or Reflection |
| Reflection Summary / Learning Log | Reflection or Course Resources |
| Answer page / Answer key | Answer Keys / teacher-only review |
| Teacher packet | Teacher prep / lesson plan area |
| Lesson plan DOCX | Lesson plan card at top of lesson |

Rules:

1. Do not mix answer keys into normal student-facing Files.
2. Do not classify KWL or Reflection as lesson body unless the Moodle structure
   clearly places it inside a lesson book.
3. AOL/Evaluation items should remain discoverable by unit and by evaluation
   category.

## 8. OSS, CDN, and Hybrid Storage Rules

Hybrid storage is the standard production model.

### 8.1 ECS Content

ECS keeps:

1. Manifest/catalog/status files.
2. Lightweight HTML, JSON, TXT, CSS, and small assets.
3. Ordinary documents when they are below the configured threshold and not
   high-concurrency playable media.

### 8.2 OSS/CDN Content

OSS/CDN must receive:

1. iSpring HTML5 packages, including `presentation.html`, `data/`, scripts,
   fonts, images, audio, and video segments.
2. H5P packages and playable H5P runtime assets.
3. Videos: `.mp4`, `.webm`, `.mov`, `.m4v`.
4. Large attachments and high-concurrency downloadable assets.
5. Raw course ZIP packages when using hybrid-worker import.

### 8.3 Do Not Use Size Alone

Routing is based on resource type and role first:

1. A small iSpring package still belongs on OSS/CDN.
2. A small video still belongs on OSS/CDN.
3. A pure document course without iSpring/H5P/video can remain on ECS.

### 8.4 CDN Verification

Use actual resource URLs, not the browser address bar.

For videos:

```js
document.querySelector('video')?.currentSrc ||
document.querySelector('video source')?.src
```

For iSpring:

```js
document.querySelector('base')?.href
```

and inspect Network resource URLs. Correct CDN resources use:

```text
https://cdn.moodletool.work/courseware-active/<COURSE>/...
```

The page address may still be:

```text
https://www.moodletool.work/courseware/<COURSE>/...
https://moodletool.work/embed/ispring/...
```

when it is a same-origin shell, wrapper, or direct HTML entry.

## 9. Course Package Rules

### 9.1 ZIP Shape

A valid course package must contain `course-manifest.json` at the package root.

Expected:

```text
course-manifest.json
Unit 1/...
ispring-localized/...
course-sections/...
```

Invalid:

```text
MCR3U-course-package-fixed-.../
  course-manifest.json
  Unit 1/...
```

The invalid nested-root shape causes:

```text
Overflow package must contain course-manifest.json
```

### 9.2 Batch Upload

Batch upload is for multiple course ZIPs selected at once.

Rules:

1. Each ZIP is recognized by course code from filename.
2. Each file has its own progress, speed, total size, and ETA.
3. The top progress bar shows overall progress only.
4. Do not display overall total size or ETA inside the first file row.
5. Auto-create import tasks only when the user explicitly enables the checkbox.
6. Do not restart/deploy the portal during an active browser-to-OSS upload unless
   the user accepts the risk.

## 10. Script Reuse Rules

Prefer reusable scripts over course-specific patches.

Recommended scripts and patterns:

```text
scripts/repair-course-book-section-embeds.mjs
scripts/audit-course-ispring-local-refs.mjs
scripts/index-oss-courseware-assets.mjs
scripts/cleanup-course-oss-stale-assets.mjs
scripts/package-clean-course.mjs
scripts/import-hybrid-raw-package.mjs
```

Course-specific scripts are acceptable for source normalization, but their output
must follow the standard manifest and HTML rules in this document.

When adding a new St.Mary/New Moodle course:

1. Build or import Moodle activity/book manifest.
2. Localize Moodle activity resources.
3. Localize iSpring/H5P/video.
4. Repair book section embeds.
5. Validate references.
6. Package with root-correct ZIP shape.
7. Import through hybrid-worker.
8. Index OSS assets.
9. Verify front-end rendering.

## 11. Required Validation Checklist

Run or manually verify the following before considering a course done.

### 11.1 Source-to-Portal Gap Audit

Every course handoff must include a source-to-portal gap audit. Do this even if
the course looks correct at first glance, because Course Overview, Moodle book
sections, activity pages, iSpring, H5P, and video can come from different source
shapes.

The audit must answer four questions:

1. What does Moodle/source expose?
2. What exists in local `courseware/<COURSE>`?
3. What is registered in `course-manifest.json`?
4. What is visible in the portal UI?

Never assume lesson iSpring coverage means Course Overview iSpring is covered.
Course Overview iSpring is its own required check.

Use this local manifest inspection as the minimum baseline:

```bash
cd /path/to/ossd-course-portal

COURSE=MCR3U
ROOT=/path/to/courseware
export COURSE ROOT

node - <<'NODE'
const fs = require("fs");
const path = require("path");

const course = process.env.COURSE;
const root = process.env.ROOT;
const manifestPath = path.join(root, course, "course-manifest.json");
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const lessons = (m.units || []).flatMap((u) => (u.lessons || []).map((l) => ({ unit: u.unit, ...l })));
const expectedSections = ["Lesson Expectations", "Lesson", "Hands On", "Consolidation", "Homework"];

const overviewIspring = (m.courseSections || [])
  .filter((x) => /overview/i.test(`${x.role || ""} ${x.label || ""} ${x.path || ""}`))
  .flatMap((x) => x.ispring || []);

const lessonRows = lessons.map((lesson) => {
  const sections = lesson.bookSections || [];
  const labels = sections.map((x) => x.sectionLabel || x.label || "");
  const missingSections = expectedSections.filter((name) => !labels.some((label) => label.toLowerCase().includes(name.toLowerCase())));
  return {
    id: lesson.id,
    title: lesson.title || lesson.label || "",
    bookSections: sections.length,
    missingSections,
    lessonIspring: (lesson.ispring || []).length,
    h5p: (lesson.h5p || []).length,
    videos: (lesson.videos || []).length + (lesson.video || []).length,
  };
});

console.log(JSON.stringify({
  course,
  courseOverviewPages: (m.courseSections || []).filter((x) => /overview/i.test(`${x.role || ""} ${x.label || ""} ${x.path || ""}`)).length,
  courseOverviewIspring: overviewIspring.length,
  lessons: lessons.length,
  lessonsMissingBookSections: lessonRows.filter((x) => x.missingSections.length).slice(0, 30),
  lessonsWithIspring: lessonRows.filter((x) => x.lessonIspring).length,
  lessonsWithH5p: lessonRows.filter((x) => x.h5p).length,
  lessonsWithVideo: lessonRows.filter((x) => x.videos).length,
}, null, 2));
NODE
```

If Moodle/source has a Course Overview presentation, the result must show
`courseOverviewIspring > 0`, and the Course Overview HTML must contain an iframe
or player block pointing at the localized presentation.

Check local HTML pages directly:

```bash
COURSE=MCR3U
ROOT=/path/to/courseware
export COURSE ROOT

find "$ROOT/$COURSE" -path '*course-overview*index.html' -o -path '*course-overview*presentation.html'
grep -R "ispring-localized\\|localized-ispring\\|embedded-h5p-frame\\|embedded-video" -n "$ROOT/$COURSE/course-sections" "$ROOT/$COURSE/Unit "* 2>/dev/null | head -100
```

Interpretation:

1. If `courseOverviewIspring` is zero but Moodle/source has an overview
   presentation, the import/localization step missed Course Overview media.
2. If `lesson.ispring`, `lesson.h5p`, or `lesson.videos` exists but the matching
   book section HTML has no embedded block, run or fix the book-section embed
   repair logic.
3. If `Hands On`, `Consolidation`, or `Homework` has meaningful Moodle text but
   is absent from `bookSections`, the crawler/importer flattened or skipped a
   Moodle book page and must be fixed before packaging.
4. If the manifest is correct but the portal UI hides the item, inspect frontend
   visibility filtering. Do not add a course-specific exception.

### 11.2 Manifest Shape

Check:

1. Course appears in catalog/options.
2. Units and lessons are present.
3. Each lesson has expected book sections.
4. iSpring/H5P/video entries exist when expected.
5. Text/material entries preserve all available materials.
6. Evaluation/AOL and answer-key resources are separated.

### 11.3 HTML Body Preservation

Open representative pages:

1. Course Overview.
2. Unit 1 Lesson 1 Lesson page.
3. Hands On.
4. Consolidation.
5. Homework.
6. Assignment/AOL page.
7. Answer Key page.
8. Course Outline or Learning Log.

Confirm that body text appears and media is embedded when present.

For Learning Log, Reflection, Course Outline, syllabus, and similar
course-level pages, also confirm that every Moodle attachment is visible as a
material row or attachment link. A page that says "Attached you will find..." but
shows no downloadable material is incomplete.

For any page with DOCX/PPTX/XLSX attachments, click both actions mentally or in
a browser check:

1. `View` must resolve to the HTML preview, not trigger a raw file download.
2. `Download` must resolve to the original file.
3. Repeated rows with the same label should be justified by different source
   files. If they are byte-identical duplicates from Moodle cache-busting query
   strings, remove the duplicate row and duplicate physical file.

### 11.4 Media References

For iSpring:

```text
node scripts/audit-course-ispring-local-refs.mjs --course <COURSE>
```

Expected:

```text
missingRefs=0
```

For OSS/CDN:

1. Confirm registry contains `courseware-active/<COURSE>/ispring-localized/` for
   iSpring courses.
2. Confirm videos and H5P assets are in OSS/CDN.
3. Confirm stale old paths do not override new paths.

### 11.5 Production Environment

Production portal must use the correct active course root:

```text
COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active
```

Do not confuse:

```text
/www/wwwroot/ossd-course-portal
/www/wwwroot/ossd-portal
/www/wwwroot/www.esunnybrook.com/moodle
```

The Moodle plugin lives under the Moodle project, not the portal project:

```text
/www/wwwroot/www.esunnybrook.com/moodle/filter/portalembed
```

## 12. Known Failure Patterns

### 12.1 Course Shows No Manifest

Likely causes:

1. `COURSE_ACTIVE_ROOT` points at the wrong root.
2. Nginx/server route is serving a protected login redirect.
3. Manifest exists locally but not under the active production root.
4. Build/server was restarted with stale environment.

### 12.2 iSpring Page Loads but Resources Are Same-Origin

Check:

1. Manifest `url` and `packageUrl`.
2. Asset registry for new `ispring-localized` paths.
3. Whether direct iSpring HTML is served with CDN `<base>`.
4. Browser Network resource URLs.

### 12.3 Book Section Text Missing

Likely causes:

1. Frontend filtered a Moodle activity shell.
2. Import flattened a text-bearing activity into a file card.
3. HTML page was not generated.
4. Manifest points to the wrong HTML path.

### 12.4 Media Card Exists but HTML Body Has No Media

Likely causes:

1. iSpring/H5P/video was localized but not embedded into the book section HTML.
2. Placeholder was removed before localization.
3. Repair script only replaced placeholders and did not implement fallback insert.

Fix in repair/import scripts, not by adding a frontend course exception.

### 12.5 Text Card Has No Buttons

Likely causes:

1. Materials exist in manifest but have no `path`, `previewPath`, `downloadPath`,
   or trusted `url`.
2. Files exist on disk but manifest paths were not backfilled.
3. Frontend filtering treats a material shell as empty.

### 12.6 Course Overview iSpring Shows `Roll.Player.*` Button Keys

Symptoms:

1. The Course Overview presentation opens and may play.
2. Buttons or adjacent labels show literal keys such as `Roll.Player.Continue`,
   `Roll.Player.Complete`, or `Roll.Player.GotoNextChapterLink`.
3. Console may show missing `lng/en-US*.json` or no obvious fatal error.

Root cause:

The localized Course Overview iSpring/Roll package is missing a valid language
JSON file, points to a broken same-origin copy, or has no fallback from
`LNG_MANIFEST[locale]` to the actual language file. This is not a normal
translation issue and should not be hidden with frontend text replacement.

Fix:

1. Keep the Course Overview iSpring package under the canonical course-level
   path, for example
   `<COURSE>/ispring-localized/unit-00/course-overview/presentation.html`.
2. Ensure a complete `lng/en-US*.json` file exists in that package and
   `JSON.parse` succeeds.
3. Patch the package HTML or repair script so the Roll player can resolve that
   language file, for example by adding a fallback when `LNG_MANIFEST[locale]`
   is empty or points to a stale file.
4. If a same-origin proxied language file is shorter or invalid while the CDN
   copy is valid, replace or regenerate the broken package copy and refresh the
   uploaded asset.

Verification:

```js
document.body.innerText.includes("Roll.Player.")
```

Expected result is `false`.

Also check the loaded language resource:

```js
performance.getEntriesByType("resource")
  .filter((r) => /lng\/en-US|presentation\.html|player\.js|lms\.js/i.test(r.name))
  .map((r) => ({ url: r.name, type: r.initiatorType, size: r.transferSize }))
```

## 13. Change Policy

When a new course exposes a new Moodle shape:

1. First inspect local courseware and manifest.
2. Compare with a known-good course of similar structure.
3. Update reusable import/repair logic when possible.
4. Add or update smoke/audit coverage for the generalized rule.
5. Only then patch a course-specific source-normalization script if the source
   data is genuinely unique.

Do not:

1. Add frontend `if (course === "...")` rules for content shape.
2. Delete courseware or OSS objects without dry-run and explicit confirmation.
3. Run deployment updates while uploads are active unless the user approves the
   risk.
4. Mix the portal project with the Moodle project paths.
