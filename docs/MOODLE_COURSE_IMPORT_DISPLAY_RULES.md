# Moodle Course Import and Display Rules

Updated: 2026-08-19

This document is the canonical rule set for importing Moodle courses into the
OSSD Course Portal. It captures the lessons learned from BAF3M, BAT4M, ENG2D,
ENG3U, ENG4U, MCR3U, MDM4U, OLC4O, SES4U, SBI3U, SBI4U, and similar
St.Mary/New Moodle courses.

The goal is to avoid course-specific frontend exceptions. Fixes should be made
in import, localization, repair, manifest generation, or storage/indexing
scripts so the same course shape works consistently across local and production.

## 0. Source-Site Course Families

Do not apply one Moodle shape to every course. First identify the source Moodle
family, then validate against that family's expected structure.

### 0.1 Legacy esunnybrook Courses

Legacy esunnybrook courses usually do not have a meaningful course-introduction
section before Course Overview. The absence of a section 0 / Course
Introduction page is not, by itself, a missing-content defect.

Use MDM4U as the current baseline for this family when checking a completed
course.

Expected legacy esunnybrook shape:

1. Course Overview / Course Resources are present when Moodle provides them.
2. Course Outline, Learning Log, syllabus, and similar course-level resources
   preserve body text plus attached files when Moodle provides attachments.
3. Course-level groups preserve the Moodle parent section. Besides Course
   Overview / Course Resources, legacy esunnybrook courses commonly include
   Homework Submission Folder, Final Examination & Culminating, and Teacher
   Packet. These are separate groups and must not be merged by title alone.
4. Units and lessons are organized around Moodle book sections:
   Lesson Expectations, Lesson, Hands On, Consolidation, and Homework.
5. iSpring, H5P, and video are embedded in the owning HTML page when the source
   page embeds or instructs them, and are also exposed as standalone playable
   entries where useful.
6. Ordinary documents such as DOCX, PDF, PPTX, XLSX, TXT, worksheets, KWL
   charts, rubrics, learning logs, and answer documents stay attached under the
   Moodle page or book section that explains them. They should not appear as
   peer cards beside the lesson HTML unless there is no owning page.
7. Standalone side-navigation pages named `Unit X - Lesson Y` and
   `Unit X - Lesson Y (Answer)` must be classified by their Moodle parent
   section before using the title. Under `Homework Submission Folder` they are
   homework-submission activities, not Teacher Packet materials. They must be
   crawled, localized, and shown together in the Homework Submission Folder
   course-resource group, not duplicated inside the lesson learning flow.
8. Empty submission-only pages such as blank dropboxes are skipped from teacher
   resource display unless they contain meaningful instructions or attached
   teaching files.
9. Course Overview iSpring and lesson iSpring must both be checked. A course can
   have working lesson iSpring while Course Overview iSpring is missing,
   referenced through a stale path, or missing its Roll/iSpring language files.

Minimum legacy esunnybrook validation:

1. Compare the Moodle side navigation against the manifest: Course Overview,
   unit books, Lesson/Hands On/Consolidation/Homework pages, Lesson activities,
   Lesson Answer activities, AOL/Evaluation, KWL/Reflection, and Answer Keys.
2. Open representative localized HTML pages and confirm body text is visible.
3. Confirm attached files are listed inside the owning page/card.
4. Confirm only iSpring, H5P, and video are standalone playable resources.
5. Confirm Homework Submission Folder pairs `Unit X - Lesson Y` immediately
   with `Unit X - Lesson Y (Answer)` when both exist there.
6. Confirm Teacher Packet contains only teacher prep, quiz/lab/test/final exam
   answer keys, evaluation answer material, and teacher-only packets.

### 0.2 St.Mary / New Moodle Courses

St.Mary/New Moodle courses often have meaningful section 0 content before
Course Overview. Treat this as a real Course Introduction area unless inspection
proves it is only Moodle chrome.

Expected new-site shape:

1. Section 0 course description, prerequisites, welcome images, and starter
   templates become Course Introduction / Introduction resources.
2. Course Overview remains a separate course-level section if Moodle provides
   it. Do not merge Course Introduction into Course Overview unless the Moodle
   source itself presents them as one page.
3. Activity pages can wrap useful content in nested containers, so extraction
   must use DOM/balanced parsing and must scan the full authenticated page for
   attachments.
4. Learning Log and similar course-level activities often have attachments
   outside the cleaned main body. Those attachments are required.
5. H5P can appear in course-level pages as well as lesson pages. The localizer
   must scan both.
6. Section 0 resource titles such as `Writing Formal Lab Reports` must not be
   misclassified as Evaluation/AOL just because they contain assessment-like
   words.
7. New-site courses still follow the same attachment rule: ordinary documents
   remain attached to their owning page; only iSpring, H5P, and video are
   standalone playable resources.

Minimum St.Mary/New Moodle validation:

1. Inspect section 0 separately and decide whether it is Course Introduction,
   Moodle chrome, or both.
2. Verify Course Introduction resources, Course Overview resources, and unit
   lesson resources separately.
3. Check Learning Log/Course Outline pages for missing attachment lists.
4. Search localized HTML for stale external H5P/iSpring references or pending
   placeholders.
5. Compare against a known-good same-family course such as SBI3U/SBI4U before
   applying an old esunnybrook assumption.

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

### 2.0 Course Introduction / Section 0

New St.Mary Moodle courses often put real course content in section 0 before
the Course Overview section. Do not treat section 0 as Moodle chrome or a
throwaway welcome banner.

Typical section 0 content may include:

1. Course description text and prerequisite text.
2. Course banner, learning-goal image, or welcome image.
3. Course starter files such as lab report templates, writing guides, or
   learning-log templates.
4. Administrative Moodle tools such as Announcements or Attendance Tracker.

Rules:

1. Preserve meaningful course description text as a course-level HTML page,
   usually under a Course Introduction or Introduction group.
2. Preserve course images as local files and rewrite image references to local
   paths.
3. Keep real starter resources such as `Lab report template` and
   `Writing Formal Lab Reports`.
4. Do not show Moodle-only tools such as forum announcements or attendance
   registers as static courseware unless they contain downloadable teaching
   material.
5. Do not remove words such as `Grade` globally during cleanup. For example,
   `Prerequisite: Science, Grade 10, Academic` is valid course text.
6. If a course-level activity title contains words such as `Lab`, do not
   automatically classify it as Evaluation/AOL. Course-introduction activity
   IDs or roles must be excluded from assessment keyword matching.
7. For St.Mary biology-style courses, compare section 0 against a known-good
   course such as SBI3U before inventing a new portal label. SBI3U uses a
   `Course Introduction` page with `role: "introduction"` plus the section 0
   starter resources. Do not create a separate `General` resource group when the
   source content is really the standard course introduction.
8. Section 0 starter resources should be present both where the course overview
   groups need them (`courseSections`) and where course-level resource indexing
   needs them (`courseDownloads`). Keep the same identity/path so the frontend
   can deduplicate rather than showing empty duplicate cards.

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
7. When localizing activity attachments, scan the full authenticated Moodle
   activity page for `pluginfile.php`/`draftfile.php` links, not only the cleaned
   main-content fragment. Some St.Mary activity file lists sit outside the
   extracted main body; Learning Log pages are a known example. Filter Moodle
   chrome assets such as `/theme_moove/logo/` so site logos are not treated as
   course materials.

### 2.3 Textbook and Official Curriculum Materials

Textbook and curriculum entries must be source-audited. Do not infer a
commercial textbook file from a similar course or a similar grade.

Rules:

1. If the Moodle Course Outline or public bibliography identifies a textbook
   name, record the title, publisher, ISBN when available, and evidence in
   `sourceAudit.textbookReference`.
2. If no legal local full-text copy is available, add only a reference/audit
   page. Do not include a full commercial textbook from another grade or course.
3. If the user provides a legally obtained local textbook file, copy it into
   `courseware/<COURSE>/texts/<slug>/`, set `type: "textbook"`,
   `role: "core_text"`, and provide both `previewPath` and `downloadPath` when
   the file type supports them.
4. Keep official Ontario Ministry curriculum guidance as a separate
   `curriculum_reference` text/material with `previewPath` and `downloadPath`.
5. Add a local `texts/SOURCES.md` or equivalent source-audit page recording
   what was included, what was excluded, and why.
6. If a local docs folder contains a textbook for a different grade or course,
   explicitly exclude it rather than silently substituting it.
7. Adding a textbook only to `manifest.texts` is not enough for courses that
   follow the SBI3U text structure. Also add the textbook material, textbook
   reference page, official curriculum document, and source-audit page to
   `courseDownloads` when the course-level resource index expects text materials
   there.
8. Set each unit's `coreTexts` to the included textbook id when the same core
   text applies course-wide. This keeps the Unit cards and the Text Index in
   sync.
9. Textbook display names must identify the owning course. Do not show generic
   names such as `Textbook`, `Nelson Textbook`, `Data Management 12`, or only a
   publisher/title when the portal could list many courses together. Use this
   order: course code, course title/subject, publication title, `Textbook`, and
   edition/year when known. Example: MDM4U · Mathematics of Data Management ·
   McGraw-Hill Ryerson Data Management 12 Textbook (2014).
10. Apply the same course-qualified name consistently to `manifest.texts[].title`,
   text material `label`, course-level text/download cards when present, and
   `texts/SOURCES.md`. Keep publisher, ISBN, copyright, and source-verification
   details in `publisher`, `notes`, `sourceAudit`, and source-audit pages rather
   than relying on an ambiguous short display title.

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
5. If Moodle has a numbered unit section such as `Unit 4: Final Examination`,
   keep it as a numbered portal unit even when it has no Moodle book lessons.
   It may contain a single final-exam lesson/resource shell, but it should not
   disappear into an unnumbered course-level section.
6. Attachments downloaded from Moodle book sections inherit the teaching role of
   the owning book section. Do not leave every book-section file as a generic
   `attachment` or `resources` item.
7. A file under a path such as `book_sections/files/04-consolidation/...` belongs
   to `role: "consolidation"` and should appear in the Consolidation flow, even
   when the filename is generic, for example `Media1.mp4`.
8. Numbered activity pages such as `Unit X - Lesson Y` and
   `Unit X - Lesson Y (Answer)` are required course activities, but their
   destination is determined by the Moodle parent section. If their parent is
   `Homework Submission Folder`, show both in the Homework Submission Folder
   course-resource group, with the regular lesson activity immediately followed
   by its matching answer activity. Do not duplicate these standalone activity
   pages in the per-lesson learning flow. Match by structured `unit` and
   `lesson` metadata, and preserve `parentSection` or `sourceGroup`; do not rely
   on loose title guessing.

### 3.1 Attached Files vs Standalone Playable Resources

Files should stay attached to the teaching page or book section that explains
how to use them. Do not promote ordinary documents into separate peer cards next
to the Moodle book-section HTML unless there is no meaningful owning page.

Rules:

1. DOCX, DOC, PDF, PPTX, XLSX, TXT, ZIP, worksheets, rubrics, KWL charts,
   learning logs, answer keys, outlines, templates, and similar documents are
   attachments/materials of the owning course page, Moodle activity, or book
   section.
2. Only playable media should normally appear as standalone resource cards:
   iSpring, video, and H5P/activity packages.
3. A standalone media card does not remove the media from the page body. If the
   source page embedded or instructed the media, keep it embedded in that HTML
   page and also expose the standalone playable entry.
4. A document linked from a Lesson, Hands On, Consolidation, Homework, Course
   Overview, Learning Log, or activity page should be rendered under that page's
   attachment/material list. For example, `Unit-1-KWL-Chart.docx` belongs under
   the Lesson page that instructs the KWL work; it should not appear as a third
   peer card beside `Lesson - ...` and the lesson iSpring.
5. If the same document is also useful in a course-level index, reference the
   same file identity/path from that index and let the frontend deduplicate.
   Do not create a second independent resource with a different role unless the
   Moodle source intentionally presents it in two teaching contexts.

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

When localizing files linked from book-section HTML, assign file roles from the
owning Moodle book section label:

| Owning book section | Attachment role |
| --- | --- |
| Lesson Expectations / Overview | `overview` |
| Lesson | `lesson` |
| Hands On | `handsOn` |
| Consolidation | `consolidation` |
| Homework | `homework` |

This applies to videos as well as DOCX/PDF attachments. A standalone playable
card is useful, but it must not move the resource out of its original teaching
flow.

### 4.2 Embedded Media and Interactive Frames in Book Sections

If a book section references iSpring, H5P, video, or an external interactive
iframe such as Quizlet, Wordwall, Genially, YouTube embed, or Vimeo embed, the
activity must remain embedded inside the HTML body.

iSpring, H5P, and video are also exposed as standalone playable resources. An
external interactive iframe is registered under the owning lesson bucket for
coverage/audit purposes, but it is not a downloadable file and should not get a
download button.

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
play/share/shortcode actions for local playable media. External interactive
iframes should have only the page embed plus, when useful, a fallback link that
opens the activity in a new tab.

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

For Moodle `mediaplugin_videojs` blocks, normalize the Moodle wrapper into the
standard local video wrapper during HTML cleanup:

```html
<div class="embedded-video">
  <video controls>
    <source src="files/04-consolidation/example.mp4" type="video/mp4">
  </video>
</div>
```

Remove Moodle-only attributes such as `data-setup-lazy`, the `video-js` class,
and empty `_blanktarget` fallback links. Keeping the raw Moodle wrapper can
leave videos visually off-center or styled by missing Moodle runtime CSS.

For St.Mary/New Moodle WordPress H5P embeds:

1. Do not delete a `welcome.hexstruct.com` iframe during HTML cleanup. If the
   iframe cannot be embedded directly, replace it with a localizable placeholder
   that preserves the H5P id, for example:

```html
<div class="portal-note" data-h5p-id="201">
  Interactive media pending local package; external playback was not embedded.
</div>
```

2. The H5P localizer must scan both lesson book sections and course-level HTML
   resources (`courseSections` and `courseDownloads`). Course-level pages such
   as `Writing Formal Lab Reports` can contain H5P even when no lesson book page
   points at that id.
3. When an H5P id appears more than once, reuse an already downloaded local H5P
   package for later occurrences. Do not let a transient fetch failure on a
   repeated id leave later pages unpatched.
4. After localization, the HTML page must contain a local iframe such as
   `localized-moodle/h5p-external/<id>-<slug>/index.html?embed=1`, not
   `welcome.hexstruct.com`, `h5p_embed`, or a pending placeholder.
5. Attach course-level H5P records to the owning course resource's
   `attachments`; attach lesson-level H5P records to the owning lesson resource
   collection.

### 4.5 External Interactive Embed Markup

External quiz-like activities are valid teaching content when they appear in a
book section, especially `Hands On`. Preserve them instead of replacing them
with a blank placeholder.

Do not blanket-convert Quizlet or other known interactive providers to external
cards. Moodle often embeds Quizlet successfully with a provider URL such as
`https://quizlet.com/.../flashcards/embed?x=1jj1`, sometimes with required
parameters such as `i=...&x=1jj1`. The import/repair step must preserve the
original iframe `src` and query string unless browser verification proves that
the specific provider/src rejects portal framing.

```html
<div class="embedded-external-frame">
  <iframe
    class="embedded-external-iframe"
    src="https://quizlet.com/.../flashcards/embed?x=1jj1"
    loading="lazy"
    allowfullscreen="allowfullscreen"
    referrerpolicy="strict-origin-when-cross-origin"
    allow="clipboard-write; fullscreen"
    title="Hands On - Quizlet Activity"></iframe>
  <p class="embedded-fallback">
    <a href="https://quizlet.com/.../flashcards/embed?x=1jj1" target="_blank" rel="noopener noreferrer">Open activity in a new tab</a>
  </p>
</div>
```

Only after browser verification shows the current iframe `src` is blocked by
the provider should the page be downgraded to an external card:

Current portal status: Quizlet iframe URLs have been verified in Chrome to
reject the OSSD portal frame with `quizlet.com refused to connect`, even when
the original Moodle embed URL and parameters are preserved. Keep Quizlet as an
external activity card for this portal unless a future provider/domain change is
verified to allow framing again.

Quizlet handling record, 2026-08-19:

1. Moodle source can display Quizlet because it runs in Moodle's page context,
   but that does not guarantee the same iframe can render under the OSSD portal
   domain or local file/server context.
2. The repair process first preserved the original Quizlet iframe exactly,
   including URLs such as `https://quizlet.com/116107466/flashcards/embed?x=1jj1`
   and parameterized URLs such as
   `https://quizlet.com/608258723/flashcards/embed?i=3tdq4f&x=1jj1`.
3. Browser verification then showed the iframe area rendering as a grey failed
   frame with `quizlet.com refused to connect`. That is a provider/browser frame
   refusal, not a missing local file, bad relative path, or lost query
   parameter.
4. Do not attempt to crawl Quizlet into a local static package as the normal
   remediation. Quizlet is a live third-party interactive SaaS component, not a
   Moodle H5P package, iSpring package, PDF, video, or document asset. The
   reliable local artifact is the source embed/open URL plus the owning lesson
   context.
5. For current portal output, replace verified-failed Quizlet iframes with an
   `embedded-external-card` in the same owning HTML page, preserve the original
   Quizlet URL on the link, and include a machine-readable reason such as
   `data-frame-blocked-reason="quizlet-rejects-portal-frame"`.
6. Keep the manifest coverage record under the owning lesson bucket, for
   example `handsOn`, with `category: "external_interactive"`,
   `role: "external_interactive"`, `source: "external_interactive"`, and
   `mode: "external"`. Do not add a download button or promote it as an
   ordinary file.
7. If a future Quizlet/domain/provider change appears to allow framing, verify
   it in the actual portal browser session before switching back to iframe
   output. Do not infer success from Moodle alone.

```html
<div class="embedded-external-card">
  <strong>External interactive activity</strong>
  <a href="https://quizlet.com/.../flashcards/embed?x=1jj1" target="_blank" rel="noopener noreferrer">Open activity in a new tab</a>
</div>
```

Rules:

1. Recognize at least Quizlet, Wordwall, Genially, YouTube embeds, and Vimeo
   embeds.
2. Keep embeddable iframes in the owning HTML page. Add a visible fallback link
   under the iframe so students can open the activity in a new tab if their
   browser/session/provider state prevents rendering. Do not move either shape
   to `Files / Activities` as an ordinary document.
3. Do not treat Quizlet as blocked by default. Preserve the exact Moodle
   iframe URL, including `i=...`, `x=1jj1`, and any future provider parameters.
4. If browser verification confirms a specific iframe is blocked, keep an
   external activity card in that same owning page and record why it was
   downgraded in the repair/import report.
5. Register the activity in the owning lesson section bucket (`handsOn`,
   `lesson`, `consolidation`, or `homework`) so completeness checks can see it.
6. Mark it as `category: external_interactive`, `role: external_interactive`,
   `source: external_interactive`, and `mode: external`.
7. Do not add `downloadPath`, `downloadUrl`, or a download button. It is a live
   external activity, not a local file.

### 4.6 Shared Embed CSS

Use centered, responsive media blocks:

```css
.localized-ispring,
.embedded-h5p-frame,
.embedded-external-frame,
.embedded-external-card,
.embedded-video {
  display: block;
  margin: 16px auto 24px;
  max-width: 100%;
  width: 100%;
}

.localized-ispring iframe,
.embedded-h5p-frame iframe,
.embedded-external-frame iframe,
.embedded-external-iframe {
  border: 0;
  display: block;
  min-height: 640px;
  width: 100%;
}

.localized-ispring iframe {
  height: min(72vh, 760px);
}

.embedded-external-frame iframe,
.embedded-external-iframe {
  border: 1px solid #d6e2f0;
  min-height: 500px;
}

.embedded-external-card {
  align-items: center;
  background: #f4f8fc;
  border: 1px solid #cfddeb;
  border-radius: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  max-width: 760px;
  padding: 14px 16px;
}

.embedded-external-card a {
  border: 1px solid #9bbce3;
  border-radius: 6px;
  color: #00396f;
  font-weight: 700;
  padding: 8px 12px;
  text-decoration: none;
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

### 5.0 Authenticated Activity HTML Extraction

St.Mary/New Moodle activity pages often wrap useful content in nested
`<div role="main">` or `<section id="region-main">` containers. Do not extract
main content with a simple non-greedy regex that stops at the first nested
closing `</div>`.

Rules:

1. Use a DOM parser or a balanced-element extractor for main-content containers.
2. Preserve meaningful text, images, iframes, and file lists from the activity.
3. Remove Moodle chrome, grading summary, previous/next navigation, and admin
   submission controls only after the useful body and attachments have been
   captured.
4. If an activity page becomes only a title and an empty wrapper after cleanup,
   compare against the authenticated Moodle source before deciding it is empty.
5. Keep an audit trail in `sourceAudit` when an authenticated source page cannot
   be fetched or a media package cannot be localized.

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
7. If an Office file has a misleading extension, for example a legacy Word CFB
   file uploaded as `.docx`, `View` must still resolve to a local HTML preview
   or download-instruction preview. Record the unsupported/legacy condition in
   the preview report, but do not let `View` fall back to the raw document.

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
5. Do not display an assignment page that has no meaningful body text, no
   attachments, and only Moodle submission-management UI such as `View all
   submissions`, `Download all submissions`, or `Make a submission`.
6. If the parent Moodle unit/section has meaningful exam or culminating
   instructions, keep that parent unit/section page and skip only the empty
   dropbox activity card.
7. Record skipped empty submission-only activities in `sourceAudit` when useful,
   but do not expose them as course downloads, unit resources, lesson downloads,
   or teacher resources.

### 5.5 Homework Submission Folder Lesson Activities

Some Moodle courses expose important lesson work as independent side-navigation
activities rather than Moodle book sections. Typical labels are:

- `Unit 1 - Lesson 1`
- `Unit 1 - Lesson 1 (Answer)`
- `Unit 5 - Lesson 3`
- `Unit 5 - Lesson 3 (Answer)`

These are required course homework-submission content, not optional navigation
chrome, when their Moodle parent section is `Homework Submission Folder`.

Rules:

1. Crawl and localize these activity pages in addition to Moodle book pages.
2. Preserve the Moodle parent section on each record, for example
   `parentSection: "Homework Submission Folder"` or
   `sourceGroup: "homework_submission_folder"`.
3. Preserve `Unit X - Lesson Y` as a homework-submission activity page with its
   body text and any linked DOCX/PDF/PPTX/XLSX/TXT materials.
4. Preserve `Unit X - Lesson Y (Answer)` as the paired answer activity for the
   same homework submission. It can remain teacher-only/restricted, but it still
   belongs with Homework Submission Folder rather than Teacher Packet.
5. In the teacher portal UI, show the regular `Unit X - Lesson Y` activity and
   its matching answer activity together in Homework Submission Folder. Do not
   also show these standalone activity cards inside the lesson flow; that flow
   is reserved for Moodle book lesson pages, embedded playable media,
   H5P/iSpring/video, and ordinary attachments that belong to the lesson
   sections.
6. Do not show a page that is only an empty Moodle submission shell with no
   meaningful body text and no attachments.
7. Do not treat this as a frontend display special case. The manifest must
   contain the localized activity path, source Moodle activity id, parent
   section/source group, role, unit, lesson, and attachments.
8. After import, grep or inspect the manifest for representative labels such as
   `Unit 1 - Lesson 1` and `Unit 1 - Lesson 1 (Answer)`. If they are absent,
   the course is incomplete even if all Moodle book sections are present.
9. Localized activity HTML pages must render attached files with portal-style
   action buttons. Do not leave raw English `View Download` text in the page.

Teacher Packet is separate. It should contain teacher preparation pages and
answer keys for quizzes, lab tests, unit tests, final exams, culminating
evaluations, evaluation rubrics, and other teacher-only packets. Do not place
Homework Submission Folder lesson activities into Teacher Packet merely because
the label contains `(Answer)`.

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
3. Localize course-level and lesson-level iSpring/H5P/video.
4. Repair book section and course-level embeds.
5. Generate previews for files attached to activities, lesson downloads, and
   `lesson.bookSections`.
6. Validate references.
7. Package with root-correct ZIP shape.
8. Import through hybrid-worker.
9. Index OSS assets.
10. Verify front-end rendering.

## 11. Required Validation Checklist

Run or manually verify the following before considering a course done.

### 11.1 Source-to-Portal Gap Audit

Every course handoff must include a source-to-portal gap audit. Do this even if
the course looks correct at first glance, because Course Overview, Moodle book
sections, activity pages, iSpring, H5P, and video can come from different source
shapes.

The audit must answer five questions:

1. Which source-site family is this course: legacy esunnybrook or St.Mary/New
   Moodle?
2. What does Moodle/source expose?
3. What exists in local `courseware/<COURSE>`?
4. What is registered in `course-manifest.json`?
5. What is visible in the portal UI?

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
const courseIntroduction = [
  ...(m.courseSections || []),
  ...(m.courseDownloads || []),
].filter((x) => /introduction/i.test(`${x.role || ""} ${x.label || ""} ${x.path || ""}`));
const allCourseItems = [
  ...(m.courseSections || []),
  ...(m.courseDownloads || []),
  ...(m.teacherResources || []),
  ...lessons.flatMap((lesson) => lesson.downloads || []),
];
const parentText = (x) => `${x.parentSection || ""} ${x.sourceGroup || ""} ${x.teacherUse || ""} ${x.role || ""}`.toLowerCase();
const numberedLesson = (x) => /^Unit\s+\d+\s*-\s*Lesson\s+\d+$/i.test(String(x.label || ""));
const numberedLessonAnswer = (x) => /^Unit\s+\d+\s*-\s*Lesson\s+\d+\s*\(Answer\)$/i.test(String(x.label || ""));
const homeworkLessonActivities = allCourseItems.filter((x) => numberedLesson(x) && /homework|submission/.test(parentText(x)));
const homeworkAnswerActivities = allCourseItems.filter((x) => numberedLessonAnswer(x) && /homework|submission/.test(parentText(x)));
const legacyNumberedLessonActivities = allCourseItems.filter(numberedLesson);
const legacyNumberedAnswerActivities = allCourseItems.filter(numberedLessonAnswer);

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
  courseIntroductionPages: courseIntroduction.length,
  courseOverviewPages: (m.courseSections || []).filter((x) => /overview/i.test(`${x.role || ""} ${x.label || ""} ${x.path || ""}`)).length,
  courseOverviewIspring: overviewIspring.length,
  homeworkLessonActivities: homeworkLessonActivities.length,
  homeworkAnswerActivities: homeworkAnswerActivities.length,
  legacyNumberedLessonActivities: legacyNumberedLessonActivities.length,
  legacyNumberedAnswerActivities: legacyNumberedAnswerActivities.length,
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

1. If this is a legacy esunnybrook course, `courseIntroductionPages: 0` may be
   normal. If this is a St.Mary/New Moodle course and section 0 has meaningful
   content, zero Course Introduction pages means the importer missed section 0.
2. If `courseOverviewIspring` is zero but Moodle/source has an overview
   presentation, the import/localization step missed Course Overview media.
3. If `homeworkLessonActivities` or `homeworkAnswerActivities` is unexpectedly
   zero for an esunnybrook course whose Homework Submission Folder has
   `Unit X - Lesson Y` and `Unit X - Lesson Y (Answer)`, the crawler either
   skipped homework-submission pages or failed to preserve their parent section.
   `legacyNumberedLessonActivities` and `legacyNumberedAnswerActivities` are
   only a compatibility check for old manifests that lack parent metadata.
4. If `lesson.ispring`, `lesson.h5p`, or `lesson.videos` exists but the matching
   book section HTML has no embedded block, run or fix the book-section embed
   repair logic.
5. If `Hands On`, `Consolidation`, or `Homework` has meaningful Moodle text but
   is absent from `bookSections`, the crawler/importer flattened or skipped a
   Moodle book page and must be fixed before packaging.
6. If the manifest is correct but the portal UI hides the item, inspect frontend
   visibility filtering. Do not add a course-specific exception.

### 11.2 Manifest Shape

Check:

1. Course appears in catalog/options.
2. Units and lessons are present.
3. Each lesson has expected book sections.
4. iSpring/H5P/video entries exist when expected.
5. Source-family expectation is respected: legacy esunnybrook may have no
   Course Introduction; St.Mary/New Moodle must preserve meaningful section 0
   content.
6. Text/material entries preserve all available materials.
7. Homework Submission Folder includes standalone `Unit X - Lesson Y` and
   matching `Unit X - Lesson Y (Answer)` pages when the source side navigation
   has them under Homework Submission Folder.
8. Attachments on `lesson.bookSections` have `path`, and where appropriate
   `previewPath`/`downloadPath`, just like attachments on activity cards.
9. Course-level H5P in pages/resources is represented locally and attached to
   the owning course resource.
10. Evaluation/AOL and answer-key resources are separated.

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
9. A standalone side-nav `Unit X - Lesson Y` activity, when the Moodle course
   has these entries.
10. A standalone side-nav `Unit X - Lesson Y (Answer)` activity, when present.

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

### 12.7 St.Mary Course-Level Page Looks Empty

Symptoms:

1. A Moodle page/activity opens locally with only a title or a blank wrapper.
2. Moodle source screenshot shows a presentation, image, text, or file list.
3. The local page may have no attachments even though the source says files are
   attached.

Likely causes:

1. Main-content extraction used a non-balanced regex and truncated nested HTML.
2. HTML cleanup removed the external iframe before the localizer could record
   its media id.
3. Attachment scanning only inspected the cleaned fragment, not the full
   authenticated activity page.

Fix:

1. Re-extract the Moodle page with a DOM parser or balanced-element extractor.
2. Preserve H5P/iSpring/video iframe identity as a localizable placeholder.
3. Scan the full authenticated activity page for files and media references.
4. Re-run media localization and preview generation.

### 12.8 Course-Level H5P Remains as a Pending Placeholder

Symptoms:

1. The page contains `Interactive media pending local package`.
2. The original Moodle page contains a `welcome.hexstruct.com` H5P iframe.
3. Lesson-level H5P is localized, but this course resource is not.

Root cause:

The H5P localizer only scanned lesson book raw exports and skipped
`courseSections`/`courseDownloads`.

Fix:

1. Scan course-level HTML resources for `welcome.hexstruct.com` iframe URLs and
   `data-h5p-id` placeholders.
2. Download the H5P package, generate a local standalone preview, and patch the
   owning HTML page to a local iframe.
3. Attach the H5P record to the owning course resource.
4. Reuse already downloaded packages when the same H5P id appears more than
   once.

Verification:

```bash
grep -R "welcome.hexstruct\\|h5p_embed\\|portal-note" "$ROOT/$COURSE/course-sections" "$ROOT/$COURSE/localized-moodle-activities" 2>/dev/null
```

Expected result: no course page should show a playable H5P as an external link
or pending placeholder.

### 12.9 Course Introduction Resource Misclassified as Evaluation

Symptoms:

1. A course starter page such as `Writing Formal Lab Reports` appears under
   Evaluation, Teacher Resources, or AOL.
2. The source Moodle location is section 0 / Introduction.

Root cause:

Broad keyword matching treats any title containing `Lab`, `Assignment`, or
similar words as assessment.

Fix:

1. Assign course-introduction resources a stable `role: "introduction"` or
   equivalent source section marker.
2. Exclude known course-introduction activity ids and roles from assessment
   keyword matching.
3. Keep the resource under Course Resources/Introduction with its body and
   attachments.

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
