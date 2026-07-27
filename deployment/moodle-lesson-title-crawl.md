# Moodle Lesson Title Crawl

Generated: 2026-07-22

Scope: numbered lesson titles extracted from visible Moodle `mod/book` table-of-contents pages. This file intentionally treats only titles like `Lesson 1`, `Lesson 1.1`, or `Lesson 1: Topic` as teacher-facing lessons. Subpages such as `Hands On`, `Consolidation`, and `Homework` remain internal chapter content for a lesson.

## Summary

- Moodle books scanned: 76
- Numbered lesson titles found: 562
- Book crawl errors: 0
- HFA4U exception: 1 book exists, but no standard numbered lesson titles were detected.
- CGW4U exception: no visible Moodle course page, so no lesson books were scanned.

## Course Totals

| Course | Books | Numbered lessons | Book-level lesson counts | Sample lesson titles |
| --- | ---: | ---: | --- | --- |
| SBI3U | 5 | 61 | 9643:13; 9672:18; 9704:16; 9735:7; 9754:7 | Lesson 1.1: Mitosis; Lesson 1.2: Effects of Mitosis; Lesson 1.3: Meiosis; Lesson 1.4: Effects of Meiosis; Lesson 1.5: Sexual vs. Asexual Reproduction |
| SCH4U | 5 | 46 | 8738:11; 8780:10; 8820:10; 8860:7; 8891:8 | Lesson 1: Atomic Structure; Lesson 2: Bohr's Atomic Theory; Lesson 3: Quantum Numbers; Lesson 4: Atomic Structure and Periodic Table; Lesson 5: Lewis Diagrams |
| SCH3U | 5 | 41 | 8602:9; 8630:5; 8649:10; 8678:9; 8705:8 | Lesson 1; Lesson 2; Lesson 3; Lesson 4; Lesson 5 |
| ESLDO | 4 | 38 | 7755:10; 7777:6; 7800:11; 7822:11 | Lesson 1: Introduction to Greek Mythology; Lesson 2: The Myth of Uranus; Lesson 3: The Myth of Prometheus; Lesson 4: Pandora's Box; Lesson 5: Demeter and Midas |
| SPH3U | 5 | 36 | 8931:7; 8951:7; 8971:7; 8992:7; 9013:8 | Lesson 1: Average Speed; Lesson 2: Uniform Motion; Lesson 3: Vectors; Lesson 4: Motion Graphs; Lesson 5: Relative Motion |
| MHF4U | 4 | 35 | 8336:9; 8362:11; 8393:8; 8415:7 | Lesson 1: Introduction to Functions; Lesson 2: Adding & Subtracting Functions; Lesson 3: Inverse Functions; Lesson 4: Multiplying Functions; Lesson 5: Graphs of Functions |
| SPH4U | 5 | 33 | 9041:7; 9070:6; 9096:7; 9126:5; 9150:8 | Lesson 1: Adding Vectors & 2D Kinematics; Lesson 2: Dynamics; Lesson 3: Projectile Motion; Lesson 4: Newton's Laws of Motion; Lesson 5: Friction |
| BOH4M | 5 | 31 | 7380:7; 7403:6; 7427:5; 7447:9; 7481:4 | Lesson 1: Introduction to Managers & Organizations; Lesson 2: Management Theories; Lesson 3: Issues of Ethics and Social Responsibilities; Lesson 4: Social Responsibility Strategies; Lesson 5: Ethical Behavior Analysis |
| BBB4M | 4 | 30 | 7244:7; 7265:8; 7289:8; 7314:7 | Lesson 1: Introduction; Lesson 2: What is Trade?; Lesson 3: Globalization and Canada's International Partners; Lesson 4: Canada's Imports and Exports; Lesson 5: Barriers to Trade |
| HFA4U | 1 | 0 | 9805:0 | No standard numbered lesson titles detected. |
| MPM2D | 4 | 29 | 8474:7; 8497:7; 8520:8; 8545:7 | Lesson 1: Representing Linear Relations; Lesson 2: Graphical Solutions; Lesson 3: Solving Systems of Linear Equations by Substitution; Lesson 4: Solving Systems of Linear Equations by Elimination; Lesson 5: Translating Words into Mathematical Expressions |
| ESLEO | 4 | 28 | 7891:7; 7914:8; 7938:7; 7960:6 | Lesson 1: Pre-writing Strategies; Lesson 2: Writing Structure; Lesson 3: Writing for Different Audiences; Lesson 4: Revising and Editing Your Draft Part 1; Lesson 5: Revising and Editing Your Draft Part 2 |
| SBI4U | 5 | 27 | 9506:6; 9527:6; 9549:4; 9566:7; 9589:4 | Lesson 1: Chemical Bonding; Lesson 2: Water; Lesson 3: Functional Groups & Biomolecules; Lesson 4: Enzymes; Lesson 5: Cytoplasmic Organelles |
| ICS3U | 4 | 27 | 9393:7; 9420:7; 9446:7; 9466:6 | Lesson 1 - Basic Data types; Lesson 2 - Your First Java Program; Lesson 3 - One Dimensional Arrays; Lesson 4 - User Input Processing; Lesson 5 - Methods in Java |
| MCR3U | 4 | 27 | 8016:9; 8043:6; 8064:6; 8085:6 | Lesson 1: Functions; Lesson 2 : Linear & Quadratic Function; Lesson 3: Domain & Range; Lesson 4: Inverse Function; Lesson 5: Quadratic Equations |
| ENG4U | 4 | 26 | 7536:8; 7561:6; 7583:6; 7603:6 | Lesson 1: Type of Essay; Lesson 2: Purpose & Audience; Lesson 3: Essay Topic & Thesis; Lesson 4: Formal vs. Informal; Lesson 5: Methods of Development |
| MDM4U | 5 | 29 | 8198:7; 8222:5; 8241:6; 8262:6; 8282:5 | Lesson 1: Bias and sampling; Lesson 2: Measures of central tendency; Lesson 3: Visual display of data; Lesson 4: Scatter plots and linear correlation; Lesson 5: Linear regression |
| MCV4U | 3 | 18 | 8111:7; 8141:5; 8165:6 | Lesson 1: Limits; Lesson 2: Average & Instantaneous Rates of Changes; Lesson 3: Slope of Tangent; Lesson 4: Exploring Derivatives; Lesson 5: The Chain Rule |

## Interpretation

- This crawl gives us a realistic lesson-count baseline for unit-first portal structure, but it should not be used as a final file-completeness audit by itself.
- Moodle books often use one book per unit; book IDs are therefore practical unit containers for the portal.
- Subchapters like `Hands On`, `Consolidation`, and `Homework` should likely display inside a lesson page rather than as separate lessons in the teacher-facing navigation.
- HFA4U needs special handling because its visible Moodle book does not follow the standard numbered lesson title pattern.
