export const tableCourses = [
  { course: "ENG2D", checked: false },
  { course: "GLC2O", checked: true },
  { course: "CHV2O", checked: false },
  { course: "SNC2D", checked: true },
  { course: "MPM2D", checked: true },
  { course: "CHC2D", checked: false },
  { course: "BBI2O", checked: true, skipByDefault: true, skipReason: "User explicitly said BBI2O does not need checking." },
  { course: "AVI2O", checked: false },
  { course: "ENG3U", checked: true },
  { course: "MCR3U", checked: true },
  { course: "SCH3U", checked: true },
  { course: "BAF3M", checked: true },
  { course: "SBI3U", checked: true },
  { course: "SPH3U", checked: true },
  { course: "ENG4U", checked: true },
  { course: "MHF4U", checked: true },
  { course: "SPH4U", checked: false },
  { course: "BBB4M", checked: true },
  { course: "MCV4U", checked: true },
  { course: "SCH4U", checked: false },
  { course: "MDM4U", checked: true },
  { course: "OLC4O", checked: false },
  { course: "ICS2O", checked: false },
  { course: "ICS3U", checked: false },
];

export function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

export function readArgFromArgs(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

export function hasFlagInArgs(args, name) {
  return args.includes(name);
}

function requestedCourses(args) {
  return (readArgFromArgs(args, "--courses") || readArgFromArgs(args, "--course") || "")
    .split(",")
    .map(safeCourse)
    .filter(Boolean);
}

export function selectedTableCourses(args = process.argv) {
  const requested = new Set(requestedCourses(args));
  const checkedOnly = hasFlagInArgs(args, "--checked-only");
  const includeSkipped = hasFlagInArgs(args, "--include-bbi2o") || hasFlagInArgs(args, "--include-skipped");
  const excluded = new Set(
    (readArgFromArgs(args, "--exclude") || readArgFromArgs(args, "--exclude-courses") || "")
      .split(",")
      .map(safeCourse)
      .filter(Boolean),
  );

  return tableCourses
    .filter((row) => !requested.size || requested.has(row.course))
    .filter((row) => !checkedOnly || row.checked)
    .filter((row) => !excluded.has(row.course))
    .filter((row) => includeSkipped || !row.skipByDefault);
}

export function skippedTableCourseRows(args = process.argv) {
  const includeSkipped = hasFlagInArgs(args, "--include-bbi2o") || hasFlagInArgs(args, "--include-skipped");
  return tableCourses
    .filter((row) => row.skipByDefault && !includeSkipped)
    .map((row) => ({ course: row.course, reason: row.skipReason || "Skipped by default." }));
}
