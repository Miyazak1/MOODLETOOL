import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SCH3U");
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function rel(fromRel, toRel) {
  return posix.relative(posix.dirname(fromRel), String(toRel || "").replaceAll("\\", "/")) || ".";
}

function pageHtml(title, activitySource, pageRel, attachment) {
  const viewHref = rel(pageRel, attachment.previewPath || attachment.path);
  const downloadHref = rel(pageRel, attachment.path);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #102033; line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; box-shadow: 0 14px 36px rgba(16, 32, 51, 0.06); }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; color: #002f5f; }
    a { color: #00396f; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 22px; padding-top: 14px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; padding: 10px 12px; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { background: #f4f9ff; border: 1px solid #8db0d7; border-radius: 6px; color: #00396f; display: inline-block; font-weight: 700; padding: 5px 10px; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <section class="attachments">
        <h2>Files</h2>
        <ul>
          <li>
            <span>${htmlEscape(attachment.label)}</span>
            <span class="actions">
              <a class="button" href="${htmlEscape(viewHref, true)}">View</a>
              <a class="button" href="${htmlEscape(downloadHref, true)}" download>Download</a>
            </span>
          </li>
        </ul>
      </section>
    </article>
  </main>
</body>
</html>
`;
}

const manifest = readJson(manifestPath);
const unit2Lab = manifest.units?.[1]?.unitResources?.evaluations?.find((item) => item.moodleActivityId === "8632");
const h5p = unit2Lab?.attachments?.find((item) => item.type === "h5p" && /formal-lab-reports/i.test(item.label || item.path || ""));
const hvp = manifest.units?.[1]?.unitResources?.additional?.find((item) => item.moodleActivityId === "9388");

if (!h5p?.path || !hvp?.path) {
  throw new Error("Could not find SCH3U Unit 2 formal lab H5P or HVP activity record.");
}
if (!existsSync(join(courseRoot, h5p.path))) {
  throw new Error(`Missing H5P package: ${h5p.path}`);
}

const attachment = {
  label: "formal-lab-reports-1.h5p",
  type: "h5p",
  category: "localized_moodle_attachment",
  role: "attachment",
  path: h5p.path,
  bytes: h5p.bytes,
  source: h5p.source,
  fileSource: h5p.fileSource,
  ...(h5p.previewPath ? { previewPath: h5p.previewPath } : {}),
};

hvp.attachments = [attachment];
hvp.textPreview = "Formal lab reports Moodle HVP activity localized as an H5P package.";
hvp.source = "https://www.esunnybrook.com/mod/hvp/view.php?id=9388";

const pageAbs = join(courseRoot, hvp.path);
writeFileSync(pageAbs, pageHtml(hvp.label || "Formal lab reports", hvp.source, hvp.path, attachment), "utf8");
hvp.bytes = statSync(pageAbs).size;

manifest.sourceAudit ||= {};
manifest.sourceAudit.sch3uFormalLabHvpPatchedAt = new Date().toISOString();
manifest.sourceAudit.sch3uFormalLabHvp = {
  source: hvp.source,
  localizedFrom: h5p.path,
  note: "The Moodle HVP shell did not expose a clean standalone local body after localization; this page points to the matching Moodle-downloaded formal lab H5P package used by Unit 2 Lab.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({ patched: hvp.path, attachment: attachment.path, previewPath: attachment.previewPath || null }, null, 2));
