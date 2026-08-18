import { readFileSync } from "node:fs";

for (let unit = 1; unit <= 4; unit += 1) {
  const path = `D:/工作文件/SUNNYBROOK/ossd-course-portal/inbox/moodle-book-raw-SNC1D-U0${unit}.json`;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  let refs = 0;
  const interesting = [];
  for (const lesson of raw.lessons || []) {
    for (const section of lesson.sections || []) {
      refs += section.page?.refs?.length || 0;
      for (const ref of section.page?.refs || []) {
        if (/hexstruct|ispring|youtube|h5p|pluginfile|draftfile|\.mp4/i.test(ref.url)) {
          interesting.push({ unit, lesson: lesson.lesson, label: section.label, tag: ref.tag, text: ref.text, url: ref.url });
        }
      }
    }
  }
  console.log(JSON.stringify({ unit, lessons: raw.lessons?.length || 0, refs, interestingCount: interesting.length, interesting: interesting.slice(0, 50) }, null, 2));
}
