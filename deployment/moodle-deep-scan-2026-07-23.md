# Moodle Deep Scan 2026-07-23

This pass attempted to re-check higher-value Moodle courses that are visible in the category list but not yet usable enough to promote into the portal.

## Result

The in-app browser reached the Moodle login page for each direct course page below, so this pass could not inspect course sections, assignments, attachments, or Moodle Book contents.

| Course | Moodle ID | Intended check | Result |
|---|---:|---|---|
| ENG2D | 8 | Course outline, Books, assignment attachments | Login required |
| OLC4O | 9 | Course outline, Books, assignment attachments | Login required |
| ICS4U | 37 | Course outline, Books, assignment attachments | Login required |
| ICS2O | 36 | Course outline, Books, assignment attachments | Login required |
| MTH1W | 59 | Course outline, Books, assignment attachments | Login required |
| PPL3O | 58 | Course outline, Books, assignment attachments | Login required |
| PPL1O | 57 | Course outline, Books, assignment attachments | Login required |
| CGC1D | 43 | Course outline, Books, assignment attachments | Login required |

## Current Action

Do not promote these courses into `course-catalog.json` from this scan alone. They still need an authenticated Moodle pass to avoid adding empty shells.

## Next Authenticated Pass

After Moodle is logged in inside the Codex in-app browser, re-scan the same list and extract:

- Course Outline files from assignment intro attachments.
- Moodle Book IDs and chapter counts.
- Any obvious unit/lesson structure.
- Direct file resources that can become course downloads or lesson downloads.

