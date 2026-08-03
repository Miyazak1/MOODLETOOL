import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/admin-upload-form-panel.js", "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

function selectElement() {
  return {
    disabled: false,
    innerHTML: "",
    options: [],
    value: "",
    append(option) {
      this.options.push(option);
      this.innerHTML += option.textContent;
      if (!this.value) this.value = option.value;
    },
  };
}

function field() {
  return { hidden: false };
}

const unit = selectElement();
const lesson = selectElement();
const unitField = field();
const lessonField = field();
const textIdField = field();
const typeHelp = { textContent: "" };

const panel = context.window.AdminUploadFormPanel.createPanel({
  elements: {
    lesson,
    lessonField,
    textIdField,
    typeHelp,
    unit,
    unitField,
  },
  createOption(label, value) {
    return { textContent: label, value: String(value) };
  },
});

assert.equal(panel.uploadTypeLabel("ispring-zip"), "iSpring ZIP");
assert.equal(panel.unitLessonText({ unit: 2, lesson: 3 }), "Unit 2 · Lesson 3");
assert.equal(panel.unitLessonText({}), "Course level");

const manifest = {
  units: [
    { unit: 1, title: "Intro", lessons: [{ lesson: 1, title: "A" }] },
    { unit: 2, title: "Next", lessons: [] },
  ],
};

panel.updateTypeFields({ manifest, type: "lesson-plan" });
assert.equal(unitField.hidden, false);
assert.equal(lessonField.hidden, false);
assert.equal(textIdField.hidden, true);
assert.match(typeHelp.textContent, /Lesson Plan/);
assert.equal(unit.options.length, 3);
assert.equal(unit.options.at(-1).textContent, "New Unit 3");
assert.equal(lesson.options.at(-1).textContent, "New Lesson 2");

unit.value = "2";
lesson.options = [];
lesson.innerHTML = "";
panel.populateLessonOptions({ manifest, type: "ispring-zip" });
assert.equal(lesson.disabled, true);
assert.equal(lesson.options[0].textContent, "No lessons indexed");

panel.updateTypeFields({ manifest, type: "text-material" });
assert.equal(unitField.hidden, true);
assert.equal(lessonField.hidden, true);
assert.equal(textIdField.hidden, false);
assert.match(typeHelp.textContent, /Literary Text/);

console.log("admin upload form panel smoke ok");
