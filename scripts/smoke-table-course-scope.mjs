import assert from "node:assert/strict";
import { selectedTableCourses, skippedTableCourseRows, tableCourses } from "./lib/table-course-scope.mjs";

const checkedCourses = [
  "GLC2O",
  "SNC2D",
  "MPM2D",
  "ENG3U",
  "MCR3U",
  "SCH3U",
  "BAF3M",
  "SBI3U",
  "SPH3U",
  "ENG4U",
  "MHF4U",
  "BBB4M",
  "MCV4U",
  "MDM4U",
];

assert.equal(tableCourses.length, 24, "The table scope should include 24 non-NONE course rows, including BBI2O.");
assert.equal(selectedTableCourses(["node", "smoke"]).length, 23, "Default table scope should skip BBI2O.");
assert.equal(selectedTableCourses(["node", "smoke", "--include-bbi2o"]).length, 24, "--include-bbi2o should restore BBI2O.");
assert.equal(skippedTableCourseRows(["node", "smoke"]).map((row) => row.course).join(","), "BBI2O");
assert.deepEqual(
  selectedTableCourses(["node", "smoke", "--checked-only"]).map((row) => row.course),
  checkedCourses,
  "Checked-only table scope drifted from the spreadsheet status.",
);
assert.deepEqual(
  selectedTableCourses(["node", "smoke", "--courses", "ENG2D,GLC2O"]).map((row) => row.course),
  ["ENG2D", "GLC2O"],
  "Explicit course filtering should preserve table order and requested courses.",
);
assert.deepEqual(
  selectedTableCourses(["node", "smoke", "--exclude", "ENG2D,GLC2O"]).slice(0, 2).map((row) => row.course),
  ["CHV2O", "SNC2D"],
  "Exclude filtering should remove requested courses from table order.",
);

console.log("table course scope smoke passed.");
