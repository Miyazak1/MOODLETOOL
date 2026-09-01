import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mainPath = resolve(import.meta.dirname, "../src/main.tsx");
const source = readFileSync(mainPath, "utf8");
const match = /function isEmptyMoodleActivityShell\(item: LinkableResource\): boolean \{([\s\S]*?)\n\}/.exec(source);

if (!match) {
  throw new Error("Could not find isEmptyMoodleActivityShell in src/main.tsx.");
}

const body = match[1];
const requiredTargets = ["item.path", "item.previewPath", "item.downloadPath", "item.url", "item.previewUrl", "item.downloadUrl"];
const missingTargets = requiredTargets.filter((target) => !body.includes(target));

if (missingTargets.length) {
  throw new Error(`CDN-only playable visibility guard is missing targets: ${missingTargets.join(", ")}`);
}

if (!body.includes("resourceTarget") || !body.includes('type !== "html"') || !body.includes('type !== "htm"')) {
  throw new Error("Non-HTML resources with URL-only targets must not be treated as empty Moodle shells.");
}

console.log("CDN-only playable visibility smoke passed.");
