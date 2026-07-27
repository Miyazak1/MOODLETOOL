const baseUrl = normalizeBaseUrl(readArg("--base-url") || process.env.DEPLOY_SMOKE_BASE_URL || "http://127.0.0.1:8891");
const username = readArg("--username") || process.env.DEPLOY_SMOKE_USERNAME || "";
const password = readArg("--password") || process.env.DEPLOY_SMOKE_PASSWORD || "";
const course = (readArg("--course") || process.env.DEPLOY_SMOKE_COURSE || "ENG3U").toUpperCase();
const adminUsername = readArg("--admin-username") || process.env.DEPLOY_SMOKE_ADMIN_USERNAME || "";
const adminPassword = readArg("--admin-password") || process.env.DEPLOY_SMOKE_ADMIN_PASSWORD || "";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function normalizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function combineCookies(...cookies) {
  return cookies.filter(Boolean).join("; ");
}

function url(path) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function encodeCoursePath(courseCode, path) {
  return `/courseware/${encodeURIComponent(courseCode)}/${String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

async function request(path, options = {}) {
  return fetch(url(path), {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
}

async function jsonRequest(path, options = {}) {
  const response = await request(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

function pass(label, detail = "") {
  console.log(`OK ${label}${detail ? ` - ${detail}` : ""}`);
}

function fail(label, detail = "") {
  console.error(`FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  process.exitCode = 1;
}

function expect(condition, label, detail = "") {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

function firstLocalResource(manifest) {
  const candidates = [];
  for (const item of manifest.courseDownloads || []) candidates.push(item);
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) candidates.push(item);
  }
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) candidates.push(unit.unitPlan);
    for (const item of Object.values(unit.unitResources || {}).flat()) candidates.push(item);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) candidates.push(lesson.lessonPlan);
      for (const item of lesson.downloads || []) candidates.push(item);
      for (const item of lesson.textExports || []) candidates.push(item);
      for (const item of lesson.ispring || []) candidates.push(item);
    }
  }
  return candidates.find((item) => item?.path || item?.previewPath || item?.downloadPath);
}

if (!username || !password) {
  console.error("Usage: node scripts/smoke-deployed-site.mjs --base-url https://your-domain --username teacher --password password --course ENG3U");
  process.exit(2);
}

console.log(`Deployed site smoke: ${baseUrl}`);

const loginPage = await request("/login");
expect(loginPage.status === 200, "login page is reachable", `status ${loginPage.status}`);

const anonymousCatalog = await request("/course-catalog.json");
expect(
  anonymousCatalog.status === 302 && (anonymousCatalog.headers.get("location") || "").includes("/login"),
  "anonymous catalog request is redirected to login",
  `status ${anonymousCatalog.status}`,
);

const badLogin = await jsonRequest("/api/portal/login", {
  method: "POST",
  body: JSON.stringify({ username, password: `${password}-wrong` }),
});
expect(badLogin.response.status === 401, "portal rejects bad teacher password", `status ${badLogin.response.status}`);

const login = await jsonRequest("/api/portal/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
const portalCookie = cookieFrom(login.response);
expect(login.response.status === 200 && login.data?.authenticated && portalCookie, "teacher portal login succeeds", `status ${login.response.status}`);

const session = await jsonRequest("/api/portal/session", {
  headers: { Cookie: portalCookie },
});
expect(session.response.status === 200 && session.data?.authenticated, "teacher session is readable", `user ${session.data?.username || ""}`);

const catalog = await jsonRequest("/course-catalog.json", {
  headers: { Cookie: portalCookie },
});
const catalogCodes = (catalog.data?.courses || []).map((item) => String(item.code || "").toUpperCase());
expect(catalog.response.status === 200 && catalogCodes.includes(course), "assigned course appears in catalog", `${course}; ${catalogCodes.length} course(s) visible`);

const manifestResponse = await request(`/courseware/${encodeURIComponent(course)}/course-manifest.json`, {
  headers: { Cookie: portalCookie },
});
const manifest = await manifestResponse.json().catch(() => null);
expect(
  manifestResponse.status === 200 && manifest?.course?.code === course,
  "assigned course manifest is readable",
  `status ${manifestResponse.status}`,
);

const localResource = manifest ? firstLocalResource(manifest) : null;
if (!localResource) {
  fail("course manifest has at least one local view/download resource");
} else {
  const resourcePath = localResource.previewPath || localResource.path || localResource.downloadPath;
  const resourceResponse = await request(encodeCoursePath(course, resourcePath), {
    headers: { Cookie: portalCookie },
  });
  expect(resourceResponse.status === 200, "assigned course local resource opens", `${resourcePath}; status ${resourceResponse.status}`);
}

const adminUploadsProbe = await request(`/courseware/${encodeURIComponent(course)}/_admin_uploads/upload-history.jsonl`, {
  headers: { Cookie: portalCookie },
});
expect(
  [403, 404].includes(adminUploadsProbe.status),
  "admin upload storage is not publicly readable",
  `status ${adminUploadsProbe.status}`,
);

if (adminUsername || adminPassword) {
  const adminLogin = await jsonRequest("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  const adminCookie = cookieFrom(adminLogin.response);
  expect(adminLogin.response.status === 200 && adminLogin.data?.ok && adminCookie, "admin login succeeds", `status ${adminLogin.response.status}`);

  const adminStatus = await jsonRequest(`/api/admin/status?course=${encodeURIComponent(course)}`, {
    headers: { Cookie: combineCookies(portalCookie, adminCookie) },
  });
  expect(adminStatus.response.status === 200 && adminStatus.data?.ok, "admin can read course status", `status ${adminStatus.response.status}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log("Deployed site smoke passed.");
