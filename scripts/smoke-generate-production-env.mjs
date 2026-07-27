import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".generate-env-smoke");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

assertInside(projectRoot, smokeRoot, "smoke output");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });

try {
  const envPath = join(smokeRoot, ".env.production");
  const credentialsPath = join(smokeRoot, "credentials.txt");
  run(process.execPath, [
    "scripts/generate-production-env.mjs",
    "--out", envPath,
    "--credentials-out", credentialsPath,
    "--courses", "ENG3U,ESLEO",
    "--domain", "portal.example.com",
  ]);
  if (!existsSync(envPath)) throw new Error("Generated env file is missing.");
  if (!existsSync(credentialsPath)) throw new Error("Generated credentials file is missing.");
  run(process.execPath, ["scripts/check-production-env.mjs", "--env", envPath]);
  console.log("Production env generation smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}
