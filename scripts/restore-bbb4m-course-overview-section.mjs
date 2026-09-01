import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BBB4M");
const manifestPath = join(courseRoot, "course-manifest.json");
const overviewRel = "course-sections/course-overview/index.html";
const overviewAbs = join(courseRoot, overviewRel);

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function courseRelativeFromHref(pageRel, href) {
  if (!href || /^https?:\/\//i.test(href)) return "";
  return toPosix(posix.normalize(posix.join(posix.dirname(toPosix(pageRel)), href.split("#")[0].split("?")[0])));
}

function typeForPath(path) {
  return extname(path).replace(".", "").toLowerCase() || "file";
}

function parseAttachments(html) {
  const attachments = [];
  const rowPattern = /<li>\s*<span class="file-label">([\s\S]*?)<\/span>\s*<span class="file-actions">([\s\S]*?)<\/span>\s*<\/li>|<div class="file-row">\s*<div class="file-label">([\s\S]*?)<\/div>\s*<div class="actions">([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const label = stripTags(match[1] || match[3] || "");
    const actions = match[2] || match[4] || "";
    const hrefs = [...actions.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((hrefMatch) => hrefMatch[1]);
    const path = courseRelativeFromHref(overviewRel, hrefs[hrefs.length - 1] || hrefs[0] || "");
    if (!label || !path) continue;
    const fullPath = join(courseRoot, path);
    attachments.push({
      label,
      type: typeForPath(path),
      category: "localized_moodle_attachment",
      role: "attachment",
      path,
      bytes: existsSync(fullPath) ? statSync(fullPath).size : 0,
    });
  }
  return attachments;
}

if (!existsSync(overviewAbs)) throw new Error(`Missing ${overviewAbs}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const html = readFileSync(overviewAbs, "utf8");
manifest.courseSections ||= [];
const overview = {
  label: "Course Overview",
  type: "html",
  category: "moodle_course_section",
  role: "course_overview",
  path: overviewRel,
  bytes: statSync(overviewAbs).size,
  source: "https://www.esunnybrook.com/course/view.php?id=70&section=1",
  sectionNumber: 1,
  attachments: parseAttachments(html),
  textPreview: stripTags(html).slice(0, 500),
};
const index = manifest.courseSections.findIndex((item) => item.role === "course_overview" || item.path === overviewRel);
if (index >= 0) manifest.courseSections[index] = { ...manifest.courseSections[index], ...overview };
else manifest.courseSections.push(overview);
manifest.courseSections.sort((a, b) => {
  const order = (item) => item.role === "introduction" ? 0 : item.role === "course_overview" ? 1 : item.role?.includes("final") || item.role?.includes("culminating") ? 9 : 5;
  return order(a) - order(b);
});
manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewRestore = {
  restoredAt: new Date().toISOString(),
  path: overviewRel,
  attachments: overview.attachments.length,
  note: "Restored Course Overview manifest record from existing localized course-section HTML.",
};
if (manifest.sourceAudit.teacherPacketSupplement) {
  manifest.sourceAudit.teacherPacket = {
    status: "supplemented_from_stmary",
    evidence: `Legacy esunnybrook BBB4M did not expose Teacher Packet; user provided St.Mary supplemental activity ${manifest.sourceAudit.teacherPacketSupplement.source}.`,
  };
}
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ courseSections: manifest.courseSections.length, overviewAttachments: overview.attachments.length }, null, 2));
