import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const courseRoot = path.resolve(repoRoot, "..", "courseware", "MHF4U");
const manifestPath = path.join(courseRoot, "course-manifest.json");

const externalCardCss = `    .embedded-external-card { align-items: center; background: #f4f8fc; border: 1px solid #cfddeb; border-radius: 8px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; margin: 16px auto 24px; max-width: 760px; padding: 14px 16px; }
    .embedded-external-card a { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; font-weight: 700; padding: 8px 12px; text-decoration: none; }`;

function decodeHtmlUrl(value) {
  return String(value || "").replace(/&amp;/g, "&");
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textPreviewFromHtml(html) {
  return stripHtml(html).slice(0, 500);
}

function buildExternalCard(src) {
  return `<div class="embedded-external-card" data-frame-blocked-reason="quizlet-rejects-portal-frame"><strong>External interactive activity</strong><a href="${escapeAttr(src)}" target="_blank" rel="noopener noreferrer">Open activity in a new tab</a></div>`;
}

function buildStandardArticle(src) {
  return `<article class="content"><h1 id="header">Hands On Activity - Post Skills Check Quiz</h1>
<p></p>
<h3>About</h3>
<p>In this first activity, you will review the skills that you will need to know in order to succeed in this unit. This activity&nbsp; contains a short quiz, which will allow you to test your understanding of these skills. Note that this is a practice quiz, which means that it does not count in your grades.</p>
<p>The short quiz located below will test your understanding of the topics.</p>
<p><strong>Instructions</strong></p>
<p></p>
<ul>
<li><strong>The grade for this quiz will not be counted in your final mark for this course</strong></li>
<li>Click on the button at the bottom of this page when you are ready to start the quiz</li>
<li>You should try to achieve 100% on this quiz before you move on to the next activity. You may repeat this quiz as many times as necessary</li>
</ul>
<p></p>
<h3>Quiz</h3>
<p></p>
${buildExternalCard(src)}</article>`;
}

function ensureExternalCardCss(html) {
  if (html.includes(".embedded-external-card")) return html;
  if (html.includes("    .embedded-video video")) {
    return html.replace("    .embedded-video video", `${externalCardCss}\n    .embedded-video video`);
  }
  if (html.includes("    .content table")) {
    return html.replace("    .content table", `${externalCardCss}\n    .content table`);
  }
  return html.replace("</style>", `${externalCardCss}\n  </style>`);
}

function repairQuizletArticle(html, src) {
  const articleMatch = html.match(/<article class="content">([\s\S]*?)<\/article>/i);
  if (!articleMatch) return html;

  const article = articleMatch[0];
  const articleInner = articleMatch[1];
  const hasStandardBody = /Hands On Activity - Post Skills Check Quiz/i.test(articleInner);

  if (!hasStandardBody) {
    return html.replace(article, buildStandardArticle(src));
  }

  const card = buildExternalCard(src);
  const repairedArticle = article
    .replace(/<p>\s*(?:<br\s*\/?>\s*)?<iframe\b(?=[^>]*quizlet\.com)[\s\S]*?<\/iframe>\s*<\/p>/i, card)
    .replace(/<p>\s*<\/p>\s*<div class="embedded-external-card"/i, '<p></p>\n<div class="embedded-external-card"');

  return html.replace(article, repairedArticle);
}

function quizletSrcFromHtml(html) {
  const match = html.match(/<iframe\b(?=[^>]*quizlet\.com)[^>]*\bsrc="([^"]+)"/i);
  return match ? decodeHtmlUrl(match[1]) : null;
}

function updateHandsOnRecord(lesson, src) {
  const title = String(lesson.title || `Lesson ${lesson.lesson || ""}`).replace(/^Lesson\s*\d+\s*:\s*/i, "");
  lesson.handsOn = (lesson.handsOn || []).filter((item) => {
    const haystack = `${item.label || ""} ${item.url || ""} ${item.previewUrl || ""} ${item.source || ""}`;
    return !/quizlet\.com|Hands On - Quizlet Activity/i.test(haystack);
  });
  lesson.handsOn.push({
    label: "Hands On - Quizlet Activity",
    type: "external",
    category: "external_interactive",
    role: "external_interactive",
    mode: "external",
    source: "external_interactive",
    url: src,
    previewUrl: src,
    parentSection: "Hands On",
    sourceGroup: "book_section_embed",
    unit: Number(lesson.unit),
    lesson: Number(lesson.lesson),
    textPreview: `Hands On - Lesson ${lesson.lesson}: ${title}`,
  });
  lesson.resourceCounts = {
    ...(lesson.resourceCounts || {}),
    handsOn: lesson.handsOn.length,
  };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const patched = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const handsOnSection = (lesson.bookSections || []).find((section) => {
      return /03-hands-on\.html$/i.test(section.path || "") || /hands on/i.test(section.sectionLabel || "");
    });
    if (!handsOnSection?.path) continue;

    const htmlPath = path.join(courseRoot, handsOnSection.path);
    if (!fs.existsSync(htmlPath)) continue;

    const originalHtml = fs.readFileSync(htmlPath, "utf8");
    const src = quizletSrcFromHtml(originalHtml);
    if (!src) continue;

    let html = ensureExternalCardCss(originalHtml);
    html = repairQuizletArticle(html, src);

    if (html !== originalHtml) {
      fs.writeFileSync(htmlPath, html);
    }

    handsOnSection.bytes = Buffer.byteLength(html);
    handsOnSection.textPreview = textPreviewFromHtml(html);
    updateHandsOnRecord(lesson, src);
    patched.push({
      unit: lesson.unit,
      lesson: lesson.lesson,
      path: handsOnSection.path,
      url: src,
      changedHtml: html !== originalHtml,
    });
  }
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  mhf4uQuizletHandsOnExternalCardPatch: {
    patchedAt: new Date().toISOString(),
    reference: "MDM4U Quizlet Hands On pages use a visible teaching page plus an external-open card because Quizlet rejects portal framing.",
    patchedPages: patched.length,
    pages: patched.map((item) => ({
      unit: item.unit,
      lesson: item.lesson,
      path: item.path,
      url: item.url,
    })),
  },
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({ patchedPages: patched.length, patched }, null, 2));
