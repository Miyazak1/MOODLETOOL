import { spawn } from "node:child_process";

const suppliedBaseUrl = readArg("--base-url");
const smokePort = Number(readArg("--port") || 8894);
const baseUrl = suppliedBaseUrl || `http://127.0.0.1:${smokePort}`;
const requestedCourse = readArg("--course");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function resourceUrl(path, courseBaseUrl) {
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  const normalizedBase = courseBaseUrl.endsWith("/") ? courseBaseUrl : `${courseBaseUrl}/`;
  return `${normalizedBase}${path.split("/").map(encodeURIComponent).join("/")}`;
}

function resourcePreviewUrl(item, courseBaseUrl) {
  return resourceUrl(item.previewUrl || item.previewPath || item.url || item.path, courseBaseUrl);
}

function startServer() {
  if (suppliedBaseUrl) return null;
  return spawn("node", ["server.mjs", "--root", "dist", "--port", String(smokePort)], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function check(url, label, options = {}) {
  if (options.skipExternal && /^https?:\/\//i.test(url) && !url.startsWith(baseUrl)) {
    return {
      label,
      url,
      status: 0,
      ok: true,
      contentType: "external-link",
    };
  }
  const response = await fetch(url, options);
  const expectedStatuses = options.expectedStatus ? [options.expectedStatus].flat() : null;
  const ok = expectedStatuses ? expectedStatuses.includes(response.status) : response.ok || (options.headers?.Range && response.status === 206);
  return {
    label,
    url,
    status: response.status,
    ok,
    contentType: response.headers.get("content-type") || "",
  };
}

async function readJson(url, label) {
  const result = await check(url, label);
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.status} ${url}`);
  }
  const response = await fetch(url);
  return { result, json: await response.json() };
}

function firstLessonWithIspring(manifest) {
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      if (lesson.ispring?.length) return lesson;
    }
  }
  return null;
}

function firstTextMaterial(manifest) {
  for (const text of manifest.texts || []) {
    if (text.materials?.length) return { text, material: text.materials[0] };
  }
  return null;
}

function collectResourceItems(manifest) {
  const records = [];
  for (const item of manifest.courseDownloads || []) records.push(item);
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) records.push(unit.unitPlan);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) records.push(lesson.lessonPlan);
      for (const item of lesson.downloads || []) records.push(item);
      for (const item of lesson.textExports || []) records.push(item);
    }
  }
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) records.push(item);
  }
  return records;
}

const results = [];
const server = startServer();

try {
  if (server) await sleep(1500);
  results.push(await check(joinUrl(baseUrl, "/"), "app shell"));

  const catalogRead = await readJson(joinUrl(baseUrl, "/course-catalog.json"), "course catalog");
  results.push(catalogRead.result);

  const catalog = catalogRead.json;
  const course = requestedCourse
    ? catalog.courses.find((item) => item.code.toLowerCase() === requestedCourse.toLowerCase())
    : catalog.courses.find((item) => item.code === catalog.defaultCourse) || catalog.courses[0];
  if (!course) throw new Error(`No course available for ${requestedCourse || catalog.defaultCourse}`);

  const manifestRead = await readJson(joinUrl(baseUrl, course.manifestUrl), `${course.code} manifest`);
  results.push(manifestRead.result);

  const manifest = manifestRead.json;
  for (const item of manifest.courseDownloads || []) {
    results.push(await check(joinUrl(baseUrl, resourceUrl(item.url || item.path, course.baseUrl)), `${course.code} course document: ${item.label}`, { skipExternal: true }));
  }

  const localResources = collectResourceItems(manifest).filter((item) => item.path);
  if (!localResources.length) throw new Error(`${course.code} has no local resource to smoke test`);

  const previewResource = localResources.find((item) => item.previewPath || item.previewUrl);
  if (previewResource) {
    results.push(
      await check(
        joinUrl(baseUrl, resourcePreviewUrl(previewResource, course.baseUrl)),
        `${course.code} preview: ${previewResource.label}`,
        { skipExternal: true },
      ),
    );
  }

  const firstLocalResource = localResources[0];
  results.push(
    await check(
      joinUrl(baseUrl, resourceUrl(firstLocalResource.path, course.baseUrl)),
      `${course.code} local resource: ${firstLocalResource.label}`,
      { skipExternal: true },
    ),
  );

  const lesson = firstLessonWithIspring(manifest);
  if (lesson) {
    const ispring = lesson.ispring[0];
    results.push(await check(joinUrl(baseUrl, resourceUrl(ispring.url || ispring.path, course.baseUrl)), `${lesson.id} iSpring page`, { skipExternal: true }));
  }

  const textMaterial = firstTextMaterial(manifest);
  if (textMaterial) {
    results.push(
      await check(
        joinUrl(baseUrl, resourceUrl(textMaterial.material.url || textMaterial.material.path, course.baseUrl)),
        `${course.code} text material: ${textMaterial.text.title}`,
        { skipExternal: true },
      ),
    );
  }

  const firstVideo = (manifest.units || [])
    .flatMap((unit) => unit.lessons || [])
    .flatMap((item) => item.downloads || [])
    .find((item) => item.type === "mp4");
  if (firstVideo) {
    results.push(
      await check(joinUrl(baseUrl, resourceUrl(firstVideo.path, course.baseUrl)), `${course.code} video range`, {
        headers: { Range: "bytes=0-1023" },
      }),
    );
  }

  results.push(
    await check(joinUrl(baseUrl, `/courseware/${course.code}/_admin_uploads/upload-history.jsonl`), `${course.code} admin upload folder blocked`, {
      expectedStatus: 403,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  server?.kill();
  process.exit(1);
}

let failed = false;
for (const result of results) {
  const marker = result.ok ? "OK" : "FAIL";
  console.log(`${marker} ${result.status} ${result.label} ${result.contentType}`);
  if (!result.ok) {
    console.error(`  ${result.url}`);
    failed = true;
  }
}

server?.kill();
if (failed) process.exit(1);
