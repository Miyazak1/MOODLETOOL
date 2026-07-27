import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ZZZEXTERNAL";
const courseRoot = join(workspaceRoot, "courseware", course);

const externalDoc = {
  label: "External Course Outline",
  type: "link",
  category: "course_document",
  role: "course_outline",
  url: "https://example.com/course-outline",
  source: "external",
};

const externalPlan = {
  label: "External Unit Plan",
  type: "link",
  category: "teacher_plan",
  role: "plan",
  url: "https://example.com/unit-plan",
  source: "external",
};

try {
  rmSync(courseRoot, { recursive: true, force: true });
  mkdirSync(courseRoot, { recursive: true });
  writeFileSync(
    join(courseRoot, "course-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        course: {
          code: course,
          title: "External Resource Smoke",
          audience: "Teachers preparing OSSD lessons",
          source: "Smoke test",
        },
        sourceAudit: {
          lessonCount: 1,
          ispringExpected: 1,
          ispringComplete: 1,
        },
        navigation: { primary: "unit", secondary: "lesson" },
        courseDownloads: [externalDoc],
        texts: [
          {
            id: "external-text",
            title: "External Text",
            author: "Smoke",
            type: "reference",
            units: [1],
            copyrightStatus: "school_licensed",
            sourceStatus: "link_only",
            notes: "External link smoke item.",
            materials: [
              {
                label: "External Text File",
                type: "link",
                category: "core_text",
                role: "core_text",
                url: "https://example.com/text-file",
                source: "external",
              },
            ],
            externalLinks: [
              {
                label: "External Reading Page",
                type: "link",
                category: "core_text",
                role: "core_text",
                url: "https://example.com/reading-page",
                source: "external",
              },
            ],
          },
        ],
        units: [
          {
            unit: 1,
            title: "Unit 1",
            coreTexts: ["external-text"],
            unitPlan: externalPlan,
            unitResources: {},
            summary: { downloads: 1, ispring: 1, docx: 0, pdf: 0, video: 0, h5p: 0 },
            lessons: [
              {
                id: "U1L1",
                unit: 1,
                lesson: 1,
                title: "External Lesson",
                path: "lessons/U01L01",
                bookPageCount: 0,
                lessonText: [],
                textExports: [],
                lessonPlan: {
                  label: "External Lesson Plan",
                  type: "link",
                  category: "teacher_plan",
                  role: "plan",
                  url: "https://example.com/lesson-plan",
                  source: "external",
                },
                ispring: [
                  {
                    label: "External iSpring",
                    mode: "external",
                    url: "https://example.com/ispring/presentation.html",
                    source: "external",
                    slideCount: 1,
                    videoSegmentCount: 0,
                  },
                ],
                downloads: [
                  {
                    label: "External Download",
                    type: "link",
                    category: "lesson",
                    role: "lesson",
                    url: "https://example.com/download",
                    source: "external",
                  },
                ],
                resourceCounts: { downloads: 1, lessonPlan: 1 },
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = spawnSync("node", ["scripts/validate-manifest.mjs", "--course", course], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) process.exit(result.status || 1);
} finally {
  rmSync(courseRoot, { recursive: true, force: true });
}

console.log("External resource smoke passed.");
