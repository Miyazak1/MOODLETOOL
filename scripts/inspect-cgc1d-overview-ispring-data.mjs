import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("D:/工作文件/SUNNYBROOK/courseware/CGC1D/ispring-localized/unit-00/CourseOverview/presentation.html");
const html = readFileSync(path, "utf8");
const match = html.match(/const playerData = "([\s\S]*?)";\n/);
if (!match) throw new Error("playerData not found");
const data = JSON.parse(JSON.parse(`"${match[1]}"`));
const attachments = [];

function walk(value, pathParts = []) {
  if (!value || typeof value !== "object") return;
  if (value.t === "a" || value.fn || value.fe) {
    attachments.push({
      path: pathParts.join("."),
      key: value.k || "",
      type: value.t || "",
      filename: value.fn || "",
      extension: value.fe || "",
      size: value.fs || 0,
      isLinked: value.iL ?? null,
      source: value.s || "",
    });
  }
  for (const [key, child] of Object.entries(value)) walk(child, [...pathParts, key]);
}

walk(data);
console.log(JSON.stringify(attachments, null, 2));
