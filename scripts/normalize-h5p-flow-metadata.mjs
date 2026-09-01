import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function text(value) {
  return String(value ?? "");
}

function normalizeRole(value) {
  return text(value)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/home_work/g, "homework");
}

function flowScope(value) {
  return text(value)
    .toLowerCase()
    .replace(/home[\s_-]*work/g, "homework");
}

function toPosix(value) {
  return text(value).replaceAll("\\", "/");
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isH5p(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = flowScope([item?.label, item?.role, item?.category, item?.path, item?.previewPath, item?.localizedPackagePath, item?.localizedPreviewPath].join(" "));
  return type === "h5p" || type === "h5pactivity" || category.includes("h5p") || /(?:\/h5p\/|\/h5p-external\/|\.h5p(?:$|[?#]))/i.test(scope);
}

function flowFromScope(item, collectionName) {
  if (collectionName === "handsOn") return "hands_on";
  const role = normalizeRole(item?.role);
  if (role === "hands_on" || role === "handson") return "hands_on";
  if (role === "consolidation" || role === "exit_activity" || role === "exit_slip") return "consolidation";
  if (role === "homework") return "homework";

  const strongScope = flowScope([item?.parentSection, item?.sectionLabel, item?.sectionTitle, item?.sourceGroup].join(" "));
  if (strongScope.includes("hands")) return "hands_on";
  if (strongScope.includes("consolidation") || strongScope.includes("consoldation") || strongScope.includes("exit")) return "consolidation";
  if (strongScope.includes("homework")) return "homework";

  const pathScope = flowScope(toPosix(item?.path || item?.previewPath || ""));
  const embeddedMatch = pathScope.match(/\/downloaded_resources\/([^/]+)\/h5p\//i);
  if (embeddedMatch) {
    const embedded = normalizeRole(embeddedMatch[1]);
    if (embedded === "hands_on" || embedded === "handson") return "hands_on";
    if (embedded === "consolidation" || embedded === "consoldation") return "consolidation";
    if (embedded === "homework") return "homework";
  }

  const broadScope = flowScope([item?.label, item?.role, item?.path, item?.previewPath].join(" "));
  if (broadScope.includes("hands")) return "hands_on";
  if (broadScope.includes("consolidation") || broadScope.includes("consoldation") || broadScope.includes("exit")) return "consolidation";
  if (broadScope.includes("homework")) return "homework";
  return "";
}

function parentSectionForFlow(flow) {
  if (flow === "hands_on") return "Hands On";
  if (flow === "consolidation") return "Consolidation";
  if (flow === "homework") return "Homework";
  return "";
}

function identity(item) {
  return toPosix(item?.path || item?.previewPath || item?.localizedPackagePath || item?.localizedPreviewPath || item?.source || item?.url || item?.label);
}

function upsertByIdentity(items, next) {
  const key = identity(next);
  const existingIndex = items.findIndex((item) => identity(item) === key);
  if (existingIndex >= 0) {
    items[existingIndex] = { ...items[existingIndex], ...next };
    return false;
  }
  items.push(next);
  return true;
}

function normalizeItem(item, { unit, lesson, collectionName }) {
  if (!isH5p(item)) return { changed: false, flow: "" };
  const flow = flowFromScope(item, collectionName);
  if (!["hands_on", "consolidation", "homework"].includes(flow)) return { changed: false, flow };

  const before = JSON.stringify(item);
  const parentSection = parentSectionForFlow(flow);
  if (collectionName === "handsOn") item.role = "handsOn";
  else if (!item.role) item.role = flow;
  if (!item.mode) item.mode = "local_embed";
  if (!item.parentSection && parentSection) item.parentSection = parentSection;
  if (!item.sourceGroup) item.sourceGroup = "book_section_embed";
  if (!item.unit) item.unit = Number(unit);
  if (!item.lesson) item.lesson = Number(lesson);
  if (!item.localizedPackagePath && /\.h5p(?:$|[?#])/i.test(toPosix(item.path))) item.localizedPackagePath = item.path;
  if (!item.localizedPreviewPath && item.previewPath) item.localizedPreviewPath = item.previewPath;
  return { changed: JSON.stringify(item) !== before, flow };
}

const course = safeCourse(readArg("--course"));
if (!course) {
  console.error("Usage: node scripts/normalize-h5p-flow-metadata.mjs --course COURSE [--dry-run]");
  process.exit(2);
}

const dryRun = hasFlag("--dry-run");
const courseRoot = resolve(readArg("--course-root") || join(coursewareRoot, course));
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const report = {
  course,
  dryRun,
  scannedH5p: 0,
  normalized: 0,
  addedHandsOn: 0,
  updatedRows: [],
};

for (const unit of list(manifest.units)) {
  for (const lesson of list(unit.lessons)) {
    lesson.handsOn ||= [];
    const handsOnByIdentity = new Map(list(lesson.handsOn).map((item) => [identity(item), item]));
    for (const collectionName of ["downloads", "handsOn"]) {
      for (const [index, item] of list(lesson[collectionName]).entries()) {
        if (!isH5p(item)) continue;
        report.scannedH5p += 1;
        const { changed, flow } = normalizeItem(item, { unit: unit.unit, lesson: lesson.lesson, collectionName });
        if (changed) {
          report.normalized += 1;
          report.updatedRows.push({
            unit: unit.unit,
            lesson: lesson.lesson,
            collection: collectionName,
            index,
            flow,
            label: item.label,
            path: item.path,
          });
        }
        if (flow === "hands_on" && collectionName === "downloads" && !handsOnByIdentity.has(identity(item))) {
          const handsOnItem = { ...item, role: "handsOn" };
          normalizeItem(handsOnItem, { unit: unit.unit, lesson: lesson.lesson, collectionName: "handsOn" });
          const added = upsertByIdentity(lesson.handsOn, handsOnItem);
          if (added) {
            report.addedHandsOn += 1;
            handsOnByIdentity.set(identity(handsOnItem), handsOnItem);
          }
        }
      }
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.h5pFlowMetadataNormalization = {
  normalizedAt: new Date().toISOString(),
  ...report,
  note: "Localized book-section H5P resources carry explicit flow metadata so portal grouping prefers Hands On/Consolidation/Homework over broad title or path words such as Introduction.",
};
manifest.generatedAt = new Date().toISOString();

if (!dryRun) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const reportPath = join(projectRoot, "deployment", `${course}-h5p-flow-metadata-normalization-report.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  report.reportPath = reportPath;
}

console.log(JSON.stringify(report, null, 2));
