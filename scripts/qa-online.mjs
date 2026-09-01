import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function combineCookies(...cookies) {
  return cookies.filter(Boolean).join("; ");
}

function toUrlPath(course, relativePath) {
  return `/courseware/${encodeURIComponent(course)}/${String(relativePath || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function text(value) {
  return String(value ?? "");
}

function lowerScope(item) {
  return [
    item?.label,
    item?.type,
    item?.category,
    item?.role,
    item?.path,
    item?.previewPath,
    item?.downloadPath,
    item?.url,
    item?.previewUrl,
    item?.downloadUrl,
    item?.source,
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");
}

function isVideoResource(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerScope(item);
  return type === "video" || type === "mp4" || type === "webm" || category.includes("video") || /\.(mp4|webm|mov)(?:$|[?#])/i.test(scope);
}

function isH5PResource(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerScope(item);
  return type === "h5p" || type === "h5pactivity" || category.includes("h5p") || /(?:\/h5p\/|\/h5p-external\/|\.h5p(?:$|[?#]))/i.test(scope);
}

function isISpringResource(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerScope(item);
  return type === "ispring" || category.includes("ispring") || scope.includes("ispring-localized/");
}

function isPlayableResource(item) {
  return isVideoResource(item) || isH5PResource(item) || isISpringResource(item);
}

function hasLocalPath(item) {
  return Boolean(item?.path || item?.previewPath || item?.downloadPath || item?.packagePath);
}

function resourceIdentity(row) {
  const item = row.item;
  return [
    row.unit || "",
    row.lesson || "",
    item?.type || "",
    item?.role || "",
    item?.label || "",
    item?.path || "",
    item?.previewPath || "",
  ]
    .join("|")
    .toLowerCase();
}

function collectResources(manifest) {
  const rows = [];
  const add = (item, context = {}) => {
    if (!item || typeof item !== "object") return;
    rows.push({ item, ...context });
    for (const [attachmentIndex, attachment] of (item.attachments || []).entries()) {
      add(attachment, { ...context, scope: `${context.scope || "resource"}.attachment`, attachmentIndex });
    }
  };

  for (const [index, item] of (manifest.courseDownloads || []).entries()) add(item, { scope: "courseDownloads", index });
  for (const [index, item] of (manifest.courseSections || []).entries()) {
    add(item, { scope: "courseSections", index });
    for (const [ispringIndex, ispring] of (item.ispring || []).entries()) add(ispring, { scope: "courseSections.ispring", index, ispringIndex });
  }
  for (const [index, item] of (manifest.teacherResources || []).entries()) add(item, { scope: "teacherResources", index });
  for (const [index, item] of (manifest.evaluations || []).entries()) add(item, { scope: "evaluations", index });
  for (const [textIndex, textItem] of (manifest.texts || []).entries()) {
    for (const [index, item] of (textItem.materials || []).entries()) add(item, { scope: "texts.materials", text: textItem.title, textIndex, index });
  }
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) add(unit.unitPlan, { scope: "unit.unitPlan", unit: unit.unit });
    for (const [key, value] of Object.entries(unit.unitResources || {})) {
      if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) add(item, { scope: `unit.unitResources.${key}`, unit: unit.unit, index });
      } else {
        add(value, { scope: `unit.unitResources.${key}`, unit: unit.unit });
      }
    }
    for (const lesson of unit.lessons || []) {
      const base = { unit: unit.unit, lesson: lesson.lesson, lessonId: lesson.id, lessonTitle: lesson.title };
      if (lesson.lessonPlan) add(lesson.lessonPlan, { ...base, scope: "lesson.lessonPlan" });
      for (const [index, item] of (lesson.ispring || []).entries()) add(item, { ...base, scope: "lesson.ispring", index });
      for (const [index, item] of (lesson.bookSections || []).entries()) add(item, { ...base, scope: "lesson.bookSections", index, sectionLabel: item.sectionLabel });
      for (const [index, item] of (lesson.downloads || []).entries()) add(item, { ...base, scope: "lesson.downloads", index });
      for (const [index, item] of (lesson.handsOn || []).entries()) add(item, { ...base, scope: "lesson.handsOn", index });
      for (const [index, item] of (lesson.textExports || []).entries()) add(item, { ...base, scope: "lesson.textExports", index });
    }
  }
  return rows;
}

function manifestSummary(manifest) {
  const resources = collectResources(manifest);
  return {
    units: (manifest.units || []).length,
    lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    resources: resources.length,
    localPathResources: resources.filter(({ item }) => hasLocalPath(item)).length,
    playable: resources.filter(({ item }) => isPlayableResource(item)).length,
    h5p: resources.filter(({ item }) => isH5PResource(item)).length,
    video: resources.filter(({ item }) => isVideoResource(item)).length,
    ispring: resources.filter(({ item }) => isISpringResource(item)).length,
    handsOnH5P: resources.filter(({ item }) => isH5PResource(item) && /hands/i.test(text(item.role))).length,
    consolidationH5P: resources.filter(({ item }) => isH5PResource(item) && /consolidation/i.test(text(item.role))).length,
  };
}

function diffResourceSets(localManifest, onlineManifest) {
  const localRows = collectResources(localManifest);
  const onlineRows = collectResources(onlineManifest);
  const localKeys = new Map(localRows.map((row) => [resourceIdentity(row), row]));
  const onlineKeys = new Map(onlineRows.map((row) => [resourceIdentity(row), row]));
  return {
    localOnly: [...localKeys.entries()]
      .filter(([key]) => !onlineKeys.has(key))
      .slice(0, 100)
      .map(([, row]) => summarizeResourceRow(row)),
    onlineOnly: [...onlineKeys.entries()]
      .filter(([key]) => !localKeys.has(key))
      .slice(0, 100)
      .map(([, row]) => summarizeResourceRow(row)),
  };
}

function summarizeResourceRow(row) {
  return {
    scope: row.scope,
    unit: row.unit,
    lesson: row.lesson,
    sectionLabel: row.sectionLabel,
    label: row.item?.label || "",
    type: row.item?.type || "",
    role: row.item?.role || "",
    category: row.item?.category || "",
    path: row.item?.path || "",
    previewPath: row.item?.previewPath || "",
    downloadPath: row.item?.downloadPath || "",
  };
}

function selectProbeResources(manifest, limit) {
  const rows = collectResources(manifest)
    .filter(({ item }) => item?.previewPath || item?.path || item?.downloadPath)
    .sort((a, b) => {
      const score = (row) => {
        if (isH5PResource(row.item)) return 0;
        if (isVideoResource(row.item)) return 1;
        if (isISpringResource(row.item)) return 2;
        if (row.item?.previewPath) return 3;
        return 4;
      };
      return score(a) - score(b);
    });
  const picked = [];
  const seen = new Set();
  for (const row of rows) {
    const path = row.item.previewPath || row.item.path || row.item.downloadPath;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}

async function request(baseUrl, pathOrUrl, options = {}) {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      url,
      response,
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - startedAt,
    };
  }
}

async function requestText(baseUrl, pathOrUrl, options = {}) {
  const result = await request(baseUrl, pathOrUrl, options);
  const body = result.response ? await result.response.text().catch(() => "") : "";
  return { ...result, body, response: undefined };
}

async function requestJson(baseUrl, pathOrUrl, options = {}) {
  const result = await requestText(baseUrl, pathOrUrl, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = result.body ? JSON.parse(result.body) : null;
  } catch {
    data = null;
  }
  return { ...result, data };
}

async function loginIfNeeded(baseUrl, username, password) {
  if (!username && !password) return { cookie: "", status: "skipped" };
  const login = await requestJson(baseUrl, "/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return {
    status: login.status,
    ok: login.status === 200 && login.data?.authenticated,
    cookie: cookieFrom(login.response || { headers: new Headers() }) || "",
    body: login.data,
  };
}

function extractBundlePaths(indexHtml) {
  const paths = [];
  for (const match of indexHtml.matchAll(/\b(?:src|href)=["']([^"']*\/assets\/index-[^"']+\.(?:js|css))["']/g)) {
    paths.push(match[1]);
  }
  return [...new Set(paths)];
}

function bundleFeatureProbe(jsText) {
  return {
    hasHandsOnRoleLiteral: jsText.includes("hands_on"),
    hasLessonFlowLiteral: jsText.includes("lesson-flow"),
    hasCurrentBundleHashProbe: jsText.includes("CourseQuickNav"),
    hasAttachmentDedupePrefix: jsText.includes("attachmentOf") || jsText.includes("attachments"),
    hasPlayableResourceLogic: /h5p|ispring|video/i.test(jsText),
  };
}

function addIssue(issues, severity, rule, message, context = {}) {
  issues.push({ severity, rule, message, context });
}

function printHuman(report) {
  console.log(`${report.course} online QA: ${report.summary.status.toUpperCase()}`);
  console.log(`Base ${report.baseUrl}`);
  console.log(`Local manifest ${report.localManifest.hash.slice(0, 12)}; Online manifest ${report.onlineManifest.hash?.slice(0, 12) || "missing"}`);
  console.log(`Bundle ${report.bundle.main || "missing"} ${report.bundle.hash ? report.bundle.hash.slice(0, 12) : ""}`);
  console.log(`Resource probes ${report.resourceChecks.summary.checked}; failed ${report.resourceChecks.summary.failed}`);
  console.log(`Errors ${report.summary.errors}; Warnings ${report.summary.warnings}`);
  for (const issue of report.issues.slice(0, 30)) {
    console.log(`- [${issue.severity}] ${issue.rule}: ${issue.message}`);
  }
  if (report.issues.length > 30) console.log(`- ... ${report.issues.length - 30} more`);
}

const course = safeCourse(readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)));
const baseUrl = normalizeBaseUrl(readArg("--url") || readArg("--base-url") || "http://127.0.0.1:8891");
const username = readArg("--username") || process.env.DEPLOY_SMOKE_USERNAME || "";
const password = readArg("--password") || process.env.DEPLOY_SMOKE_PASSWORD || "";
const outPath = readArg("--out");
const jsonMode = hasFlag("--json");
const resourceLimit = Number(readArg("--limit") || 80);

if (!course) {
  console.error("Usage: npm run qa:online -- --course ICS3U --url https://www.moodletool.work [--username USER --password PASS] [--json]");
  process.exit(2);
}

const issues = [];

try {
  const courseRoot = resolve(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing local manifest: ${manifestPath}`);
  const localManifestText = readFileSync(manifestPath, "utf8");
  const localManifest = JSON.parse(localManifestText);

  let portalCookie = "";
  let login = { status: "skipped" };
  if (username || password) {
    const loginResponse = await request(baseUrl, "/api/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const loginBody = loginResponse.response ? await loginResponse.response.json().catch(() => null) : null;
    portalCookie = loginResponse.response ? cookieFrom(loginResponse.response) : "";
    login = {
      status: loginResponse.status,
      ok: loginResponse.status === 200 && loginBody?.authenticated && Boolean(portalCookie),
      user: loginBody?.username || "",
    };
    if (!login.ok) addIssue(issues, "error", "login-failed", `Portal login failed with status ${loginResponse.status}.`, { status: loginResponse.status });
  }
  const headers = portalCookie ? { Cookie: portalCookie } : {};

  const index = await requestText(baseUrl, `/?course=${encodeURIComponent(course)}`, { headers });
  if (![200, 304].includes(index.status)) {
    addIssue(issues, "error", "index-not-readable", `Index page returned status ${index.status}.`, { status: index.status, url: index.url });
    if ([301, 302, 303, 307, 308, 401, 403].includes(index.status) && !portalCookie) {
      addIssue(issues, "warn", "online-auth-required", "Online site appears to require login; rerun with --username and --password.", {});
    }
  }
  const bundlePaths = extractBundlePaths(index.body || "");
  if (!bundlePaths.length) addIssue(issues, "warn", "bundle-not-found-in-index", "Could not find assets/index-*.js in index HTML.", {});
  const mainBundlePath = bundlePaths.find((item) => item.endsWith(".js")) || "";
  let bundleText = "";
  let bundleFetch = null;
  if (mainBundlePath) {
    bundleFetch = await requestText(baseUrl, mainBundlePath, { headers });
    if (bundleFetch.status !== 200) addIssue(issues, "error", "bundle-not-readable", `Bundle returned status ${bundleFetch.status}: ${mainBundlePath}`, {});
    bundleText = bundleFetch.body || "";
  }

  const onlineManifestRequest = await requestText(baseUrl, `/courseware/${encodeURIComponent(course)}/course-manifest.json?qa=${Date.now()}`, {
    headers: { ...headers, "Cache-Control": "no-store" },
  });
  let onlineManifest = null;
  if (onlineManifestRequest.status !== 200) {
    addIssue(issues, "error", "online-manifest-not-readable", `Online manifest returned status ${onlineManifestRequest.status}.`, {
      status: onlineManifestRequest.status,
      url: onlineManifestRequest.url,
    });
    if ([301, 302, 303, 307, 308, 401, 403].includes(onlineManifestRequest.status) && !portalCookie) {
      addIssue(issues, "warn", "online-manifest-auth-required", "Online manifest is protected; rerun with --username and --password.", {});
    }
  } else {
    try {
      onlineManifest = JSON.parse(onlineManifestRequest.body);
    } catch (error) {
      addIssue(issues, "error", "online-manifest-invalid-json", `Online manifest is not valid JSON: ${error.message}`, {});
    }
  }

  const localSummary = manifestSummary(localManifest);
  const onlineSummary = onlineManifest ? manifestSummary(onlineManifest) : null;
  if (onlineSummary) {
    for (const key of Object.keys(localSummary)) {
      if (localSummary[key] !== onlineSummary[key]) {
        addIssue(issues, "warn", "manifest-summary-diff", `Manifest summary differs for ${key}: local ${localSummary[key]}, online ${onlineSummary[key]}.`, {
          key,
          local: localSummary[key],
          online: onlineSummary[key],
        });
      }
    }
  }

  const resourceDiff = onlineManifest ? diffResourceSets(localManifest, onlineManifest) : { localOnly: [], onlineOnly: [] };
  if (resourceDiff.localOnly.length) addIssue(issues, "warn", "manifest-local-only-resources", `${resourceDiff.localOnly.length} sampled local resources are not present online.`, {});
  if (resourceDiff.onlineOnly.length) addIssue(issues, "warn", "manifest-online-only-resources", `${resourceDiff.onlineOnly.length} sampled online resources are not present locally.`, {});

  const probes = onlineManifest ? selectProbeResources(onlineManifest, resourceLimit) : [];
  const checks = [];
  for (const row of probes) {
    const item = row.item;
    const relPath = item.previewPath || item.path || item.downloadPath;
    const response = await request(baseUrl, `${toUrlPath(course, relPath)}?qa=${Date.now()}`, {
      method: "GET",
      headers: { ...headers, "Cache-Control": "no-store" },
    });
    const check = {
      ...summarizeResourceRow(row),
      checkedPath: relPath,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      ms: response.ms,
    };
    checks.push(check);
    if (!check.ok) {
      addIssue(issues, "error", "online-resource-not-readable", `${item.label || relPath} returned status ${response.status}.`, check);
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  const report = {
    generatedAt: new Date().toISOString(),
    course,
    baseUrl,
    login,
    localManifest: {
      path: manifestPath,
      hash: sha256(localManifestText),
      summary: localSummary,
    },
    onlineManifest: {
      url: onlineManifestRequest.url,
      status: onlineManifestRequest.status,
      hash: onlineManifestRequest.body ? sha256(onlineManifestRequest.body) : "",
      summary: onlineSummary,
      differsFromLocal: onlineManifestRequest.body ? sha256(onlineManifestRequest.body) !== sha256(localManifestText) : null,
    },
    bundle: {
      indexStatus: index.status,
      paths: bundlePaths,
      main: mainBundlePath,
      status: bundleFetch?.status || 0,
      hash: bundleText ? sha256(bundleText) : "",
      size: bundleText.length,
      features: bundleText ? bundleFeatureProbe(bundleText) : null,
    },
    resourceDiff,
    resourceChecks: {
      limit: resourceLimit,
      checks,
      summary: {
        checked: checks.length,
        failed: checks.filter((item) => !item.ok).length,
      },
    },
    issues,
    summary: {
      status: errors ? "fail" : warnings ? "review" : "pass",
      errors,
      warnings,
    },
  };

  if (outPath) writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (jsonMode) console.log(JSON.stringify(report, null, 2));
  else {
    printHuman(report);
    if (outPath) console.log(`\nWrote ${resolve(outPath)}`);
  }
  process.exit(errors ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(2);
}
