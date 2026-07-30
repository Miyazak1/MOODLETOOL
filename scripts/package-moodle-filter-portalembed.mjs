import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(projectRoot, "moodle-plugins", "filter");
const pluginDir = join(sourceRoot, "portalembed");
const output = join(projectRoot, "public", "downloads", "filter_portalembed.zip");

if (!existsSync(join(pluginDir, "version.php")) || !existsSync(join(pluginDir, "filter.php"))) {
  console.error(`Missing Moodle filter source: ${pluginDir}`);
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });
if (existsSync(output)) rmSync(output, { force: true });

const result = spawnSync("tar", ["-acf", output, "-C", sourceRoot, "portalembed"], {
  cwd: projectRoot,
  encoding: "utf8",
  shell: false,
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "tar failed");
  process.exit(result.status || 1);
}

console.log(JSON.stringify({ output, bytes: statSync(output).size }, null, 2));
