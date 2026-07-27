import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "MTH1W");
const manifestPath = join(courseRoot, "course-manifest.json");

const TARGETS = {
  5826: "https://calendar.google.com/calendar/embed?src=47hefnlce95bo3te95vu0fivj8%40group.calendar.google.com&ctz=America%2FToronto",
  5829: "https://forms.gle/DnavquLXKX2TSw2n6",
  5976: "https://www.eqao.com/the-assessments/grade-9-math/",
  5977: "https://gsuitehelp.ca/eqao-math/",
  5836: "https://www.mathplayground.com/ASB_OrbitIntegers.html",
  5837: "https://www.mathplayground.com/math_lines_integers.html",
  5838: "https://www.mathplayground.com/ASB_SpiderMatchIntegers.html",
  5839: "https://www.mathsisfun.com/positive-negative-integers.html",
  5841: "https://mrnussbaum.com/tony-fraction-s-pizza-shop-online-game",
  5843: "https://phet.colorado.edu/en/simulations/build-a-fraction",
  5844: "https://toytheater.com/fraction-circles/",
  5845: "https://www.splashlearn.com/s/math-games/fill-in-colors-in-the-model-to-show-the-sum",
  5846: "https://www.abcya.com/games/fraction_fling",
  5858: "https://www.youtube.com/watch?v=YVi22x5RNrQ&list=PLx0MkkpbQtczD63qFTBPYaPOQMvEuD8KX&index=3",
  5861: "https://www.youtube.com/watch?v=PIYz6pMGuuc&list=PLx0MkkpbQtczD63qFTBPYaPOQMvEuD8KX&index=4",
  5862: "https://www.youtube.com/watch?v=m9RRyeFXRhA&list=PLx0MkkpbQtczD63qFTBPYaPOQMvEuD8KX&index=5",
  5878: "https://www.youtube.com/watch?v=QQoPAU5L52s&ab_channel=eHow",
  5879: "https://www.youtube.com/watch?v=F-aqjOfs_Cw&ab_channel=AnilKumar",
  5880: "https://www.youtube.com/watch?v=Aig1hkq3OsU&ab_channel=KhanAcademy",
  5881: "https://www.youtube.com/watch?v=19-Bp5t0X7o&ab_channel=TextbookTactics",
  5885: "https://www.youtube.com/watch?v=7gU4sLq1d0s&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=21",
  5868: "https://www.youtube.com/watch?v=SJpu9LRnh-o&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=15",
  5869: "https://www.youtube.com/watch?v=-q1vn3N7QOg&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=16",
  5870: "https://www.youtube.com/watch?v=VrczaTefQ8c&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=18",
  5871: "https://www.youtube.com/watch?v=lFzy7bskJZk&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=19",
  5872: "https://www.youtube.com/watch?v=XMJ72mtMn4Y&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=20",
  5873: "https://www.youtube.com/watch?v=ysDGfkPos5o&list=PLej6M3rC0dbsOlXBafph_47gukF7EXKx9",
  5874: "https://www.youtube.com/watch?v=Lj_00c31zYc&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=23",
  5875: "https://www.youtube.com/watch?v=LUQiUIIKyNE&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=17",
  5877: "https://www.youtube.com/watch?v=XB3kNJ1i_8A&list=PLej6M3rC0dbsOlXBafph_47gukF7EXKx9&index=3&ab_channel=Mr.Catley",
  5882: "https://www.youtube.com/watch?v=Xz-GpQjgRgo&list=PLvKZgDPusYMOyO4EASA87Fah_xisCoyWD&index=7&ab_channel=mathcoach247",
  5883: "https://www.youtube.com/watch?v=PSLWFL1EROI&list=PLvKZgDPusYMOyO4EASA87Fah_xisCoyWD&index=11&ab_channel=mathcoach247",
  5891: "https://www.youtube.com/watch?v=W5u9nkWOpC8&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=13",
  5892: "https://www.youtube.com/watch?v=qw_bhU1keiM&list=PLvr1lWTuzqGXXcBNWJxb4yVs7-CPShHub&index=14",
  5896: "https://www.youtube.com/watch?v=eDhuhZX9PR4&list=PL2B14CFC15E76E175&index=14&ab_channel=BrookeTownsend",
  5897: "https://www.youtube.com/watch?v=dKA5lmkqJNA&list=PL2B14CFC15E76E175&index=15&ab_channel=BrookeTownsend",
  5898: "https://www.youtube.com/watch?v=r5tpr5Ddhu4&list=PL2B14CFC15E76E175&index=16&ab_channel=BrookeTownsend",
  5899: "https://www.youtube.com/watch?v=FSHQ2CRoPgw&list=PL2B14CFC15E76E175&index=17&ab_channel=BrookeTownsend",
  5900: "https://www.youtube.com/watch?v=W3qhTgg40pA&list=PL2B14CFC15E76E175&index=18&ab_channel=BrookeTownsend",
  5902: "https://www.youtube.com/watch?v=IBYNubk8uMI&list=PL2B14CFC15E76E175&index=4&ab_channel=BrookeTownsend",
  5903: "https://www.youtube.com/watch?v=0Yc3xMWernk&list=PL2B14CFC15E76E175&index=5&ab_channel=BrookeTownsend",
  5904: "https://www.youtube.com/watch?v=2Rpml6qRDPc&list=PL2B14CFC15E76E175&index=6&ab_channel=BrookeTownsend",
  5905: "https://www.youtube.com/watch?v=vYAlelP9E-U&list=PL2B14CFC15E76E175&index=7&ab_channel=BrookeTownsend",
  5907: "https://www.youtube.com/watch?v=3qq_hlugorE&list=PL2B14CFC15E76E175&index=8&ab_channel=BrookeTownsend",
  5908: "https://www.youtube.com/watch?v=2eBRRccSAoM&list=PL2B14CFC15E76E175&index=9&ab_channel=BrookeTownsend",
  5909: "https://www.youtube.com/watch?v=6yL6ocwSoW0&list=PL2B14CFC15E76E175&index=10&ab_channel=BrookeTownsend",
  5910: "https://www.youtube.com/watch?v=chmlayzIVyg&list=PL2B14CFC15E76E175&index=12&ab_channel=BrookeTownsend",
  5912: "https://www.youtube.com/watch?v=33p3GKgQRWY&list=PL2B14CFC15E76E175&index=2&ab_channel=BrookeTownsend",
  5913: "https://www.youtube.com/watch?v=23B-9HrgV9c&list=PL2B14CFC15E76E175&index=13&ab_channel=BrookeTownsend",
  5914: "https://www.youtube.com/watch?v=Vr-bWxrni9Q&list=PL2B14CFC15E76E175&index=3&ab_channel=BrookeTownsend",
  5915: "https://www.youtube.com/watch?v=f54WLWduzfo&list=PL2B14CFC15E76E175&index=4&ab_channel=BrookeTownsend",
  5917: "https://www.youtube.com/watch?v=gRFIbx_cWXU&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=2&t=1s&ab_channel=BHNmath",
  5919: "https://www.youtube.com/watch?v=gY4l-ZOJLfM&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=2&ab_channel=BHNmath",
  5921: "https://www.youtube.com/watch?v=iTOGrv5cw7g&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=3&ab_channel=BHNmath",
  5923: "https://www.youtube.com/watch?v=KaIs9y7Dw3Y&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=4&ab_channel=BHNmath",
  5925: "https://www.youtube.com/watch?v=AvXVme0fFt8&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=5&ab_channel=BHNmath",
  5927: "https://www.youtube.com/watch?v=ZFW7sHBykIk&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=6&ab_channel=BHNmath",
  5929: "https://www.youtube.com/watch?v=qtb_MOe8XZo&list=PL1EJJkZgdtLKsmKUMMWAeYEjr2GAM84Cj&index=7&ab_channel=BHNmath",
  5931: "https://drive.google.com/file/d/1EKEgzzQCkxFNrfIEH27DnLT_E1BMo798/view?usp=sharing",
};

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function activityIdFromPath(path) {
  return String(path || "").match(/-(\d+)-[0-9a-f]{10}\//)?.[1] || "";
}

function collectItems(manifest) {
  const rows = [];
  for (const item of manifest.courseDownloads || []) rows.push(item);
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) rows.push(item);
    }
  }
  return rows.filter((item) => item?.category === "moodle_url" && item.path);
}

function standaloneHtml(title, externalUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    a { color: #00396f; font-weight: 700; }
    .button { display: inline-block; border: 1px solid #8db0d7; border-radius: 6px; padding: 8px 12px; background: #f4f9ff; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <p><a class="button" href="${htmlEscape(externalUrl, true)}" target="_blank" rel="noopener">Open external resource</a></p>
    </article>
  </main>
</body>
</html>
`;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let patched = 0;
let missingTarget = 0;

for (const item of collectItems(manifest)) {
  const id = activityIdFromPath(item.path);
  const externalUrl = TARGETS[id];
  if (!externalUrl) {
    missingTarget += 1;
    continue;
  }
  item.externalUrl = externalUrl;
  const abs = join(courseRoot, item.path);
  if (existsSync(abs)) {
    writeFileSync(abs, standaloneHtml(item.label || "External Resource", externalUrl), "utf8");
    item.bytes = statSync(abs).size;
  }
  patched += 1;
}

manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ patched, missingTarget }, null, 2));
