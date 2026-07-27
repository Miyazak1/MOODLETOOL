import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(path) {
  const env = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = stripQuotes(match[2]);
  }
  return env;
}

const envPath = resolve(projectRoot, argValue("--env", ".env.production"));
const root = argValue("--root", "dist");
const port = argValue("--port", "8891");
const portEnd = argValue("--port-end", null);
const dryRun = hasArg("--dry-run");
const skipCheck = hasArg("--skip-check");

if (!existsSync(envPath)) {
  console.error(`Production env file is missing: ${envPath}`);
  process.exit(1);
}

if (!skipCheck) {
  const check = spawnSync(process.execPath, ["scripts/check-production-env.mjs", "--env", envPath], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (check.status !== 0) process.exit(check.status || 1);
}

const loadedEnv = parseEnvFile(envPath);
const env = {
  ...process.env,
  ...loadedEnv,
  NODE_ENV: process.env.NODE_ENV || loadedEnv.NODE_ENV || "production",
};
const args = ["server.mjs", "--root", root, "--port", port];
if (portEnd) args.push("--port-end", portEnd);

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    envPath,
    command: process.execPath,
    args,
    root,
    port,
    portEnd,
    loadedKeys: Object.keys(loadedEnv).sort(),
  }, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, args, {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Production server stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code || 0);
});
