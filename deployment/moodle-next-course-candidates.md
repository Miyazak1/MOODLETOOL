# Moodle Next Course Candidates

Generated from the Codex in-app browser on 2026-07-22.
Updated on 2026-07-23 after promoting `SNC2D`, `MAP4C`, and `SNC1D`.
Refreshed on 2026-07-23 after the portal reached 54 courses and ESLCO/HFA4U Moodle Book lesson links were attached to course manifests.

## Current Scope

- Portal courses currently listed: 54
- Portal courses represented in `moodle-course-resource-index.json`: 54
- Current Moodle resource index totals: 51 ready outlines, 3 needs-url rows, 91 Moodle Books, 593 standard numbered lesson titles.
- Full manifest validation currently passes for all 54 portal courses.

## Active Next Queue

These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, MTH1W, PPL3O, PPL1O, and CGC1D have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.

| Priority | Course | Moodle ID | Reason | Expected evidence |
|---:|---|---:|---|---|

## Remaining Outline URL Gaps

These rows are the only current `needs-url` entries in `moodle-course-resource-index.json`.

| Course | Current evidence | Next action |
|---|---|---|
| HFA4U | Moodle page 91 has no standard Course Outline link; Moodle Book 9805 has 10 Unit 1 lesson entries attached locally. | Keep outline pending; use local unit/lesson plans plus Moodle Book links. |
| CGW4U | No visible Moodle page was found in category/search scan; local planning files exist. | Needs source clarification outside Moodle or a direct Moodle URL from the user. |
| BTT1O | Authenticated scan completed; no Course Outline found; Unit activities and assignments indexed. | Keep outline pending unless a separate file/source is provided. |

## Historical Notes

The notes below are retained for crawl provenance. Use **Active Next Queue** and **Remaining Outline URL Gaps** above as the current working list.

## Promoted From Candidate List

These courses were originally discovered from Moodle and have now been added to the portal.

| Course | Moodle ID | Portal status | Evidence |
|---|---:|---|---|
| SNC2D | 67 | `moodle-shell` | Course Outline attachment and 4 Moodle Book containers found. |
| MAP4C | 17 | `textbook-shell` | Textbook Moodle Book container found; no Course Outline found. |
| SNC1D | 62 | `textbook-shell` | Textbook Moodle Book container found; no Course Outline found. |

## Portal Courses Still Needing Better Moodle Evidence

These courses already exist in the portal and Moodle index, but their Moodle evidence is incomplete or needs local-file follow-up.

| Course | Moodle ID | Current evidence | Next action |
|---|---:|---|---|
| ENG3U | 86 | Course outline, 5 generic Moodle Book containers | Download outline locally; inspect Book chapters with authenticated access if needed. |
| CHC2D | 42 | Moodle shell visible, no standard outline/book found | Re-scan after login or rely on local planning files. |
| CHV2O | 41 | Course outline found | Download outline locally. |
| GLC2O | 53 | Course outline found | Download outline locally. |
| HFC3M | 56 | Moodle shell visible, no standard outline/book found | Re-scan after login or rely on local planning files. |
| HHS4U | 54 | Moodle shell visible, no standard outline/book found | Re-scan after login. |
| LKBDU | 45 | Moodle shell visible, no standard outline/book found | Re-scan after login. |
| BBI1O | 30 | Moodle shell visible, no standard outline/book found | Re-scan after login or rely on local planning files. |
| HFA4U | 91 | Incomplete Moodle shell, 1 Book, no standard outline | Needs manual Moodle/source confirmation. |
| CGW4U | - | No visible Moodle page in category/search scan | Needs source clarification outside Moodle. |

## Original Moodle Candidates

These course codes were visible in Moodle before the portal was expanded to 54 courses. Most are now represented in `public/course-catalog.json`; keep this list as discovery history, not as the current missing-course list.

| Course | Moodle ID | Category | Current status |
|---|---:|---|---|
| ASM3M | 66 | The Arts | A worksheet attachment was found through an assignment whose title includes `outline`; treat as false positive, not a course outline. |
| BAF3M | 32 | Business Studies | Visible shell, no standard outline/book found. |
| BBI2O | 65 | Business Studies | Visible shell, no standard outline/book found. |
| BTT1O | 31 | Business Studies | Authenticated scan completed; no standard outline found, but Unit activities and assignments are indexed. |
| CGC1D | 43 | Canadian and World Studies | Authenticated scan completed; Course Outline, Unit activities, assignments, folders, and attachment links indexed. |
| CIA4U | 38 | Canadian and World Studies | Visible, but only legacy/current-variant ambiguity found. Needs manual version choice. |
| ENG2D | 8 | English | Login required during 2026-07-23 deep scan. |
| EPS3O | 10 | English | Visible shell, no standard outline/book found. |
| ICS2O | 36 | Computer Studies | Login required during 2026-07-23 deep scan. |
| ICS4U | 37 | Computer Studies | Login required during 2026-07-23 deep scan. |
| MBF3C | 18 | Mathematics | Visible shell, no standard outline/book found. |
| MPM1D | 19 | Mathematics | Visible shell, no standard outline/book found. |
| MTH1W | 59 | Mathematics | Login required during 2026-07-23 deep scan. |
| OLC4O | 9 | English | Login required during 2026-07-23 deep scan. |
| PPL1O | 57 | Health and Physical Education | Login required during 2026-07-23 deep scan. |
| PPL3O | 58 | Health and Physical Education | Login required during 2026-07-23 deep scan. |
| HFN1O | 55 | Social Sciences and Humanities | Visible as `HFN1O/2O`, no standard outline/book found. |
| AVI1O | 5 | The Arts | Visible shell, no standard outline/book found. |
| AVI2O | 4 | The Arts | Visible shell, no standard outline/book found. |
| AVI3M | 68 | The Arts | Visible shell, duplicate course-code variants exist. Needs version choice. |

## Recommended Next Order

1. After Moodle login in the Codex in-app browser, re-scan `CGC1D`.
2. Download ready Course Outline files into local `courseware/<COURSE>/plans/course/` for `SNC2D`, `ENG3U`, `CHV2O`, and `GLC2O`.
3. Continue searching `MAP4C` and `SNC1D` for Course Outline / planning files; they are currently textbook-shell courses only.
4. Keep `CIA4U` and `AVI3M` pending until the correct/current Moodle version is chosen.

Details for the 2026-07-23 login-required pass are recorded in `deployment/moodle-deep-scan-2026-07-23.md`.
