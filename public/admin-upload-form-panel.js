(function () {
  const TYPE_LABELS = {
    "course-outline": "Course Outline",
    "course-introduction": "Introduction",
    "unit-plan": "Unit Plan",
    "lesson-plan": "Lesson Plan",
    "text-material": "Literary Text",
    "ispring-zip": "iSpring ZIP",
    "ispring-batch-zip": "iSpring ZIP Batch",
  };

  const TYPE_HELP = {
    "course-outline": "课程级资料：上传后进入课程文件区，不绑定 Unit/Lesson。",
    "course-introduction": "课程级资料：上传后进入课程文件区，不绑定 Unit/Lesson。",
    "unit-plan": "Unit Plan：请选择课程和 Unit。",
    "lesson-plan": "Lesson Plan：请选择课程、Unit 和 Lesson。",
    "text-material": "Literary Text：请选择课程并填写 Text ID，文件会进入 courseware/课程/texts/Text ID/。",
    "ispring-zip": "iSpring ZIP：请选择课程、Unit 和 Lesson；ZIP 内需要包含 presentation.html。",
    "ispring-batch-zip": "iSpring ZIP Batch：请选择课程；外层 ZIP 内放多个 iSpring ZIP，文件名用 U01_L01.zip 或 课程_U01_L01.zip。",
  };

  function createPanel({ elements, createOption }) {
    const { lesson, lessonField, textIdField, typeHelp, unit, unitField } = elements;

    function uploadTypeLabel(type) {
      return TYPE_LABELS[type] || type;
    }

    function unitLessonText(item) {
      const parts = [];
      if (item.unit) parts.push(`Unit ${item.unit}`);
      if (item.lesson) parts.push(`Lesson ${item.lesson}`);
      return parts.join(" · ") || "Course level";
    }

    function selectedUnitRecord(manifest) {
      const unitNumber = Number(unit.value || 1);
      return (manifest?.units || []).find((record) => record.unit === unitNumber) || null;
    }

    function populateLessonOptions({ manifest, type }) {
      const unitRecord = selectedUnitRecord(manifest);
      const lessons = unitRecord?.lessons || [];
      lesson.innerHTML = "";

      if (lessons.length) {
        lessons.forEach((record) => {
          lesson.append(createOption(`Lesson ${record.lesson} · ${record.title}`, record.lesson));
        });
      }

      if (type === "lesson-plan") {
        const nextLesson = lessons.length ? Math.max(...lessons.map((record) => record.lesson)) + 1 : 1;
        lesson.append(createOption(`New Lesson ${nextLesson}`, nextLesson));
      } else if (!lessons.length) {
        lesson.append(createOption("No lessons indexed", 1));
        lesson.disabled = true;
        return;
      }

      lesson.disabled = false;
    }

    function populateUnitOptions({ manifest, type }) {
      const units = manifest?.units || [];
      unit.innerHTML = "";

      if (units.length) {
        units.forEach((record) => {
          unit.append(createOption(`Unit ${record.unit} · ${record.title}`, record.unit));
        });
      }

      if (type === "unit-plan" || type === "lesson-plan") {
        const nextUnit = units.length ? Math.max(...units.map((record) => record.unit)) + 1 : 1;
        unit.append(createOption(`New Unit ${nextUnit}`, nextUnit));
      } else if (!units.length) {
        unit.append(createOption("Unit 1", 1));
      }

      unit.disabled = false;
      populateLessonOptions({ manifest, type });
    }

    function updateTypeFields({ manifest, type }) {
      const needsUnit = type === "unit-plan" || type === "lesson-plan" || type === "ispring-zip";
      const needsLesson = type === "lesson-plan" || type === "ispring-zip";
      const needsTextId = type === "text-material";
      unitField.hidden = !needsUnit;
      lessonField.hidden = !needsLesson;
      textIdField.hidden = !needsTextId;
      typeHelp.textContent = TYPE_HELP[type] || "";
      populateUnitOptions({ manifest, type });
    }

    return {
      populateLessonOptions,
      populateUnitOptions,
      selectedUnitRecord,
      unitLessonText,
      updateTypeFields,
      uploadTypeLabel,
    };
  }

  window.AdminUploadFormPanel = {
    createPanel,
  };
})();
