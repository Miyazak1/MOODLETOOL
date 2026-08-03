(function () {
  function requireFunction(value, name) {
    if (typeof value !== "function") throw new Error(`AdminLocalUploadAction requires ${name}.`);
    return value;
  }

  function selectedFile(fields) {
    return fields?.file?.files?.[0] || null;
  }

  function uploadUrl(fields, file) {
    const params = new URLSearchParams({
      course: fields.course.value,
      type: fields.type.value,
      filename: file.name,
      unit: fields.unit.value,
      lesson: fields.lesson.value,
      textId: fields.textId.value.trim(),
    });
    return `/api/admin/upload?${params.toString()}`;
  }

  function validateUpload({ fields, file, setStatus }) {
    if (!file) {
      setStatus("请选择文件", "", "error");
      throw new Error("请选择文件。");
    }
    if (fields.type.value === "ispring-zip" && fields.lesson.disabled) {
      setStatus("当前 Unit 没有可绑定的 Lesson", "不能上传 iSpring。请先上传或生成对应 Lesson Plan。", "error");
      throw new Error("当前 Unit 没有可绑定的 Lesson，不能上传 iSpring。请先上传或生成对应 Lesson Plan。");
    }
    if (fields.type.value === "text-material" && !fields.textId.value.trim()) {
      setStatus("请填写 Text ID", "例如 sunday-park。", "error");
      throw new Error("请填写 Text ID，例如 sunday-park。");
    }
  }

  function createAction({
    fields,
    fetchImpl = window.fetch.bind(window),
    responseMessage,
    setStatus,
    unitLessonText,
    uploadTypeLabel,
    write,
    afterSuccess,
  } = {}) {
    if (!fields) throw new Error("AdminLocalUploadAction requires fields.");
    const showStatus = requireFunction(setStatus, "setStatus");
    const messageFor = requireFunction(responseMessage, "responseMessage");
    const labelFor = requireFunction(uploadTypeLabel, "uploadTypeLabel");
    const lessonTextFor = requireFunction(unitLessonText, "unitLessonText");

    async function upload() {
      const file = selectedFile(fields);
      validateUpload({ fields, file, setStatus: showStatus });

      if (typeof write === "function") write(`Uploading ${file.name}...`);
      showStatus(
        `正在上传 ${file.name}`,
        `${labelFor(fields.type.value)} · ${lessonTextFor({ unit: fields.unit.value, lesson: fields.lesson.value })}`,
      );

      const response = await fetchImpl(uploadUrl(fields, file), {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: file,
      });
      const data = await response.json();
      if (typeof write === "function") write(data);
      if (!response.ok || !data.ok) {
        showStatus("上传失败", messageFor(data, `HTTP ${response.status}`), "error");
        throw new Error(messageFor(data, `上传失败：HTTP ${response.status}`));
      }
      fields.file.value = "";
      showStatus("上传完成", `${file.name} 已进入 ${fields.course.value}，manifest 和容量信息已刷新。`);
      if (typeof afterSuccess === "function") await afterSuccess(data, file);
      return data;
    }

    return { upload };
  }

  window.AdminLocalUploadAction = {
    createAction,
    selectedFile,
    uploadUrl,
    validateUpload,
  };
})();
