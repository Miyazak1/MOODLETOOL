import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SECRET_NAME = "OSS_EXTRACT_CALLBACK_SECRET";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage:
  node scripts/generate-oss-extract-secret.mjs
  node scripts/generate-oss-extract-secret.mjs --length 48
  node scripts/generate-oss-extract-secret.mjs --env .env.production --write

Options:
  --length <n>  Secret length in URL-safe characters. Default: 48, minimum: 32.
  --env <path>  Env file to update when --write is used.
  --write       Insert or replace ${SECRET_NAME} in the env file.
`);
}

if (hasArg("--help") || hasArg("-h")) {
  usage();
  process.exit(0);
}

const length = Number.parseInt(argValue("--length", "48"), 10);
if (!Number.isFinite(length) || length < 32) {
  console.error("Secret length must be at least 32.");
  process.exit(1);
}

const secret = randomBytes(Math.ceil((length * 3) / 4))
  .toString("base64url")
  .slice(0, length);

const envArg = argValue("--env");
const shouldWrite = hasArg("--write");

if (!shouldWrite) {
  console.log(secret);
  console.log("");
  console.log(`Add this to both .env.production and Function Compute env:`);
  console.log(`${SECRET_NAME}=${secret}`);
  process.exit(0);
}

if (!envArg) {
  console.error("--write requires --env <path>.");
  process.exit(1);
}

const envPath = resolve(process.cwd(), envArg);
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = existing.split(/\r?\n/);
let replaced = false;

const nextLines = lines.map((line) => {
  if (line.match(new RegExp(`^(?:export\\s+)?${SECRET_NAME}=`))) {
    replaced = true;
    return `${SECRET_NAME}=${secret}`;
  }
  return line;
});

if (!replaced) {
  if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
  nextLines.push(`${SECRET_NAME}=${secret}`);
}

writeFileSync(envPath, nextLines.join("\n").replace(/\n*$/, "\n"), "utf8");

console.log(`${replaced ? "Updated" : "Added"} ${SECRET_NAME} in ${envPath}`);
console.log(secret);
