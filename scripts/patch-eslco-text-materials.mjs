import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const workspaceRoot = join(repoRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ESLCO");
const manifestPath = join(courseRoot, "course-manifest.json");
const textsRoot = join(courseRoot, "texts");
const storyRoot = join(textsRoot, "after-twenty-years");
const gutenbergUrl = "https://www.gutenberg.org/files/2776/2776-0.txt";
const gutenbergPath = join(storyRoot, "The_Four_Million_Project_Gutenberg_2776.txt");
const sourcesPath = join(textsRoot, "SOURCES.md");

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "ossd-course-portal-text-audit/1.0" } }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadText(new URL(response.headers.location, url).toString()).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`download failed ${response.statusCode}: ${url}`));
          response.resume();
          return;
        }
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

function fileRecord(label, type, category, role, path, source) {
  return {
    label,
    type,
    category,
    role,
    path,
    bytes: statSync(join(courseRoot, path)).size,
    source,
  };
}

function upsertByPath(items, record) {
  const index = items.findIndex((item) => item.path === record.path);
  if (index >= 0) items[index] = { ...items[index], ...record };
  else items.push(record);
}

function upsertText(texts, record) {
  const index = texts.findIndex((item) => item.id === record.id);
  if (index >= 0) texts[index] = { ...texts[index], ...record };
  else texts.push(record);
}

mkdirSync(storyRoot, { recursive: true });

const gutenbergText = await downloadText(gutenbergUrl);
if (!/Title:\s*The Four Million/i.test(gutenbergText) || !/AFTER TWENTY YEARS/i.test(gutenbergText)) {
  throw new Error("Downloaded Project Gutenberg text did not match expected The Four Million / After Twenty Years content.");
}
writeFileSync(gutenbergPath, gutenbergText.replace(/^\uFEFF/, ""), "utf8");

const sourcesMarkdown = `# ESLCO Textbook and Text Sources

## Textbook status

The ESLCO Course Outline does not identify one fixed textbook title. Its textbook line states that the course uses various short stories, articles, films, video clips, and poetry assembled by the instructor.

Source: \`ESLCO Course Outline\`, Moodle activity \`ESLCO-Course-Oultine.docx\`.

## Confirmed related text material

- "After Twenty Years" by O. Henry is explicitly referenced in Unit 2 Lesson 3 iSpring homework directions.
- The story appears in O. Henry's *The Four Million*.
- A local copy of Project Gutenberg eBook #2776, *The Four Million*, is included because Project Gutenberg marks the text as public domain in the USA.

No unconfirmed textbook or copyrighted reader was added.
`;
writeFileSync(sourcesPath, sourcesMarkdown, "utf8");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const gutenbergRel = toPosix("texts/after-twenty-years/The_Four_Million_Project_Gutenberg_2776.txt");
const sourcesRel = toPosix("texts/SOURCES.md");
const gutenbergRecord = fileRecord(
  "The Four Million - Project Gutenberg eBook #2776.txt",
  "txt",
  "text_material",
  "source_text",
  gutenbergRel,
  gutenbergUrl,
);
const sourcesRecord = fileRecord("ESLCO Textbook and Text Sources", "md", "source_audit", "source_audit", sourcesRel, "local ESLCO Moodle/course outline audit");

manifest.texts = manifest.texts || [];
upsertText(manifest.texts, {
  id: "after-twenty-years",
  title: "After Twenty Years",
  author: "O. Henry",
  type: "short_story",
  units: [2],
  lessons: ["U02L03"],
  copyrightStatus: "public_domain",
  sourceStatus: "downloadable",
  notes: "Confirmed by ESLCO Unit 2 Lesson 3 iSpring homework directions; included via Project Gutenberg eBook #2776, The Four Million.",
  materials: [gutenbergRecord],
  publicDomainSource: {
    label: "Project Gutenberg eBook #2776, The Four Million",
    url: "https://www.gutenberg.org/ebooks/2776",
    rights: "Public domain in the USA according to Project Gutenberg.",
  },
});
manifest.texts.sort((a, b) => `${a.units?.[0] || 99}|${a.title}`.localeCompare(`${b.units?.[0] || 99}|${b.title}`));

manifest.courseDownloads = manifest.courseDownloads || [];
upsertByPath(manifest.courseDownloads, sourcesRecord);

for (const unit of manifest.units || []) {
  if (unit.unit === 2) {
    unit.coreTexts = Array.from(new Set([...(unit.coreTexts || []), "after-twenty-years"]));
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textbookStatus: "No single fixed textbook exposed; ESLCO Course Outline identifies instructor-assembled short stories, articles, films, video clips, and poetry.",
  textbookEvidence: [
    {
      label: "ESLCO Course Outline",
      path: "localized-moodle-activities/assign/course-7650-d35ccc3c35/files/d0c9bf45fe-ESLCO-Course-Oultine.docx",
      evidence: "Textbook line names various short stories, articles, films, video clips, and poetry assembled by the instructor.",
    },
  ],
  textMaterialCount: manifest.texts.reduce((sum, text) => sum + (text.materials?.length || 0), 0),
  textSourceAuditPath: sourcesRel,
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: "ESLCO",
  texts: manifest.texts.map((text) => text.id),
  added: [gutenbergRel, sourcesRel],
  textbookStatus: manifest.sourceAudit.textbookStatus,
}, null, 2));
