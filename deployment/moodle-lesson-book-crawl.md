# Moodle Lesson Book Crawl

Generated: 2026-07-22

Scope: visible Moodle `mod/book` lesson containers crawled from the logged-in in-app browser. This records book IDs and detected chapter-link counts only. No lesson content or file contents were downloaded.

## Summary

- Courses crawled: 18
- Moodle book containers found: 76
- Book pages with readable chapter directories: 76
- Book crawl errors: 0
- Special cases:
  - HFA4U has only 1 visible book container even though most full courses have 3-5.
  - CGW4U still has no visible Moodle course page, so it is not included here.

## Book Containers

| Course | Moodle course ID | Book IDs and detected chapter counts |
| --- | ---: | --- |
| SBI3U | 89 | 9643: 65; 9672: 90; 9704: 80; 9735: 35; 9754: 35 |
| SCH4U | 82 | 8738: 55; 8780: 50; 8820: 50; 8860: 35; 8891: 40 |
| SCH3U | 81 | 8602: 45; 8630: 25; 8649: 50; 8678: 45; 8705: 40 |
| ESLDO | 74 | 7755: 50; 7777: 30; 7800: 55; 7822: 55 |
| SPH3U | 83 | 8931: 35; 8951: 35; 8971: 35; 8992: 35; 9013: 40 |
| MHF4U | 79 | 8336: 45; 8362: 55; 8393: 40; 8415: 35 |
| SPH4U | 84 | 9041: 35; 9070: 30; 9096: 35; 9126: 25; 9150: 40 |
| BOH4M | 71 | 7380: 35; 7403: 35; 7427: 25; 7447: 45; 7481: 20 |
| BBB4M | 70 | 7244: 35; 7265: 40; 7289: 40; 7314: 35 |
| HFA4U | 91 | 9805: 50 |
| MPM2D | 80 | 8474: 35; 8497: 35; 8520: 40; 8545: 35 |
| ESLEO | 75 | 7891: 35; 7914: 40; 7938: 35; 7960: 30 |
| SBI4U | 88 | 9506: 30; 9527: 30; 9549: 20; 9566: 35; 9589: 20 |
| ICS3U | 87 | 9393: 35; 9420: 35; 9446: 35; 9466: 30 |
| MCR3U | 76 | 8016: 44; 8043: 30; 8064: 30; 8085: 30 |
| ENG4U | 72 | 7536: 40; 7561: 31; 7583: 30; 7603: 30 |
| MDM4U | 78 | 8198: 35; 8222: 25; 8241: 30; 8262: 30; 8282: 25 |
| MCV4U | 77 | 8111: 35; 8141: 25; 8165: 30 |

## Use In The Portal

- These book IDs are stable Moodle entry points for lesson-content crawling.
- They can be used to map Moodle lesson structures to our unit-first page model before downloading iSpring ZIPs or Office/PDF lesson files.
- The detected chapter counts are link counts, not final lesson counts. Moodle book navigation often repeats chapter links or includes subchapter entries, so these counts are best used for completeness checks and crawl planning, not as the final teacher-facing lesson totals.

## Next Actions

- Batch download the 17 ready Course Outline documents with `DOWNLOAD_COURSE_DOCUMENT_QUEUE_AND_IMPORT.bat` after Moodle credentials are available.
- Use the book IDs above to crawl chapter titles and page contents course-by-course when building lesson-level online views.
- Keep HFA4U and CGW4U in the exception list until alternate source material is found.
