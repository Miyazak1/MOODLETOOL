import assert from "node:assert/strict";
import {
  directUploadKindCanAutoPublish,
  inferCourseCodeFromFileName,
  isPlayableCoursewareAsset,
  normalizeDirectUploadKind,
  playableCoursewareVideoExts,
} from "./lib/media-delivery-assets.mjs";

assert.equal(inferCourseCodeFromFileName("ESLDO-course-package-20260803.zip", ["ENG3U", "ESLDO"]), "ESLDO");
assert.equal(inferCourseCodeFromFileName("my-ENG3U-backup.zip", ["ENG3U", "ENG4U"]), "ENG3U");
assert.equal(inferCourseCodeFromFileName("english-course.zip", ["ENG3U"]), "");

assert.equal(normalizeDirectUploadKind("VIDEO"), "video");
assert.equal(directUploadKindCanAutoPublish("video"), true);
assert.equal(directUploadKindCanAutoPublish("course-package"), false);

assert.equal(playableCoursewareVideoExts.has(".mp4"), true);
assert.equal(isPlayableCoursewareAsset("localized-moodle/video/U02L02/Food.webm"), true);
assert.equal(isPlayableCoursewareAsset("Unit 1/Lesson 1/html5-package/presentation.html"), true);
assert.equal(isPlayableCoursewareAsset("localized-moodle-activities/resource/file.docx.html"), false);

console.log("media delivery asset helpers smoke ok");
