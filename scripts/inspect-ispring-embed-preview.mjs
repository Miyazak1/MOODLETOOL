const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/inspect-ispring-embed-preview.mjs URL");
  process.exit(1);
}
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "";

const jar = new Map();
const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function splitSetCookie(value) {
  return String(value || "").split(/,(?=\s*[^;,]+=)/g).filter(Boolean);
}

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const text of splitSetCookie(value)) {
      const [pair] = text.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

function cookieHeader() {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(target, options = {}, redirects = 0) {
  const headers = { ...(options.headers || {}) };
  headers["user-agent"] ||= ua;
  const cookies = cookieHeader();
  if (cookies) headers.cookie = cookies;
  const response = await fetch(target, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), target).toString(), options, redirects + 1);
  }
  return response;
}

const contentId = new URL(url).pathname.match(/\/embed_player\/([^/?#]+)/)?.[1];
if (!contentId) throw new Error(`Cannot extract iSpring content id from ${url}`);

const embedResponse = await request(url, { headers: { accept: "text/html,application/xhtml+xml" } });
const html = await embedResponse.text();
const csrf = html.match(/<meta name=["']csrf-token["'] content=["']([^"']+)/i)?.[1] || "";
const bff = JSON.parse(html.match(/<script id=["']ispring-bff-data["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || "{}");
const accountID = bff?.environment?.account?.accountID;
if (!csrf || !accountID) throw new Error("Missing csrf or accountID");

const infoResponse = await request(`${url}/info`, {
  method: "POST",
  headers: {
    accept: "application/json,*/*",
    "content-type": "application/json",
    "x-requested-with": "FetchApiRequest",
    "x-csrf-token": csrf,
    referer: url,
  },
  body: "{}",
});
if (!infoResponse.ok) throw new Error(`info HTTP ${infoResponse.status}`);
const info = await infoResponse.json();

const previewResponse = await request(`https://hexstruct.ispring.com/sharing/api/v1/embed_preview/${accountID}/${contentId}/en-US`, {
  method: "POST",
  headers: {
    accept: "application/json,*/*",
    "content-type": "application/json",
    "x-requested-with": "FetchApiRequest",
    authorization: `bearer ${info.authKey}`,
    referer: url,
  },
  body: "{}",
});
if (!previewResponse.ok) throw new Error(`preview HTTP ${previewResponse.status}`);
const preview = await previewResponse.json();
if (outPath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  contentId,
  accountID,
  title: preview.title || info.title,
  playerUrl: preview.playerData?.playerUrl,
  previewKeys: Object.keys(preview),
  playerDataKeys: Object.keys(preview.playerData || {}),
  playerDataType: typeof preview.playerData,
  playerDataSample: JSON.stringify(preview.playerData).slice(0, 1200),
}, null, 2));
