import fs from "node:fs";
import path from "node:path";

const courseRoot = "D:/工作文件/SUNNYBROOK/courseware/SBI3U";
const excludedDirs = new Set([
  "previews-html",
  "ispring-localized"
]);
const excludedPathParts = [
  `${path.sep}localized-moodle${path.sep}h5p-external${path.sep}`
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      if (excludedPathParts.some((part) => `${full}${path.sep}`.includes(part))) continue;
      walk(full, files);
    }
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(full);
  }
  return files;
}

function fileRowsFromLegacySection(sectionHtml) {
  const rows = [];
  const rowRe = /<div class="file-row">([\s\S]*?)<\/div><\/div>/gi;
  let match;
  while ((match = rowRe.exec(sectionHtml))) {
    const row = match[1];
    const label = row.match(/<div class="file-label">([\s\S]*?)<\/div>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
    const actions = [...row.matchAll(/<a class="button" href="([^"]+)"([^>]*)>(View|Download|查看|下载)<\/a>/gi)];
    const view = actions.find((action) => /View|查看/i.test(action[3]))?.[1];
    const download = actions.find((action) => /Download|下载/i.test(action[3]))?.[1] || view;
    if (!label || !download) continue;
    rows.push({ label, view: view || download, download });
  }
  return rows;
}

function attachmentSection(rows) {
  const items = rows.map((row) => {
    const view = row.view || row.download;
    const download = row.download || row.view;
    return `<li><span class="file-label">${row.label}</span><span class="file-actions"><a class="file-action" href="${view}">查看</a><a class="file-action" href="${download}" download>下载</a></span></li>`;
  }).join("");
  return `<section class="attachments"><h2>Files</h2><ul>${items}</ul></section>`;
}

function normalizeHtml(html) {
  let next = html;

  next = next.replace(/<center><div class="submissionlinks">[\s\S]*?<\/center>/gi, "");

  next = next.replace(/<section class="files"><h2>Files<\/h2>([\s\S]*?)<\/section>/gi, (full) => {
    const rows = fileRowsFromLegacySection(full);
    return rows.length ? attachmentSection(rows) : "";
  });

  next = next.replace(/<\/article>\s*(<section class="attachments">[\s\S]*?<\/section>)/gi, "$1</article>");

  next = next.replace(/\.files \{[^}]*\}\s*/g, "");
  next = next.replace(/\.file-row \{[^}]*\}\s*/g, "");
  next = next.replace(/\.actions \{[^}]*\}\s*/g, "");
  next = next.replace(/\.button \{[^}]*\}\s*/g, "");

  if (!next.includes(".attachments {")) {
    next = next.replace(
      /(\.content td, \.content th \{[^}]*\}\s*)/,
      `$1    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }\n    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }\n    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }\n    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }\n    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }\n    .file-action:hover { background: #eef6ff; }\n`
    );
  }

  next = next.replace(
    /@media \(max-width: 720px\) \{([^}]*)\.file-row \{[^}]*\}([^}]*)\}/g,
    "@media (max-width: 720px) {$1.attachments li { align-items: stretch; flex-direction: column; }$2}"
  );

  return next;
}

let changed = 0;
const samples = [];
for (const file of walk(courseRoot)) {
  const before = fs.readFileSync(file, "utf8");
  const after = normalizeHtml(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed += 1;
    if (samples.length < 8) samples.push(path.relative(courseRoot, file).replace(/\\/g, "/"));
  }
}

console.log(JSON.stringify({ course: "SBI3U", changed, samples }, null, 2));
