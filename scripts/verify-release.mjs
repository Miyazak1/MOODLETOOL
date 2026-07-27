import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const checks = [
  {
    label: "server syntax",
    command: "node",
    args: ["--check", "server.mjs"],
  },
  {
    label: "teacher admin inline script syntax",
    run: () => {
      const html = readFileSync("public/teacher-admin.html", "utf8");
      const match = html.match(/<script>([\s\S]*)<\/script>/);
      if (!match) throw new Error("No inline script found in public/teacher-admin.html");
      new Function(match[1]);
    },
  },
  {
    label: "manifest validation",
    command: "npm.cmd",
    args: ["run", "validate:manifest"],
  },
  {
    label: "courseware file signature validation",
    command: "npm.cmd",
    args: ["run", "validate:file-signatures"],
  },
  {
    label: "readiness audit",
    command: "npm.cmd",
    args: ["run", "audit:readiness"],
  },
  {
    label: "course roadmap",
    command: "npm.cmd",
    args: ["run", "audit:course-roadmap"],
  },
  {
    label: "course roadmap validation",
    command: "npm.cmd",
    args: ["run", "validate:course-roadmap"],
  },
  {
    label: "online resource audit",
    command: "npm.cmd",
    args: ["run", "audit:online-resources"],
  },
  {
    label: "upload gap checklist",
    command: "npm.cmd",
    args: ["run", "export:gap-checklist"],
  },
  {
    label: "content workbench",
    command: "npm.cmd",
    args: ["run", "audit:content-workbench"],
  },
  {
    label: "Office preview queue",
    command: "npm.cmd",
    args: ["run", "export:preview-queue"],
  },
  {
    label: "iSpring package queue",
    command: "npm.cmd",
    args: ["run", "export:ispring-queue"],
  },
  {
    label: "Moodle resource index",
    command: "npm.cmd",
    args: ["run", "export:moodle-index"],
  },
  {
    label: "Moodle resource index validation",
    command: "npm.cmd",
    args: ["run", "validate:moodle-index"],
  },
  {
    label: "Moodle document queue validation",
    command: "npm.cmd",
    args: ["run", "validate:moodle-doc-queue"],
  },
  {
    label: "Moodle document download plan",
    command: "npm.cmd",
    args: ["run", "plan:moodle-doc-queue"],
  },
  {
    label: "Moodle document download report validation",
    command: "npm.cmd",
    args: ["run", "validate:moodle-doc-download-report"],
  },
  {
    label: "Moodle document downloader syntax",
    command: "node",
    args: ["--check", "scripts/download-moodle-document-queue.mjs"],
  },
  {
    label: "production build",
    command: "npm.cmd",
    args: ["run", "build"],
  },
  {
    label: "Baota deployment preflight",
    command: "npm.cmd",
    args: ["run", "preflight:baota"],
  },
  {
    label: "Baota release package smoke",
    command: "npm.cmd",
    args: ["run", "smoke:package-baota"],
  },
  {
    label: "production env checker syntax",
    command: "node",
    args: ["--check", "scripts/check-production-env.mjs"],
  },
  {
    label: "production env checker smoke",
    command: "npm.cmd",
    args: ["run", "smoke:production-env"],
  },
  {
    label: "production env generator smoke",
    command: "npm.cmd",
    args: ["run", "smoke:generate-production-env"],
  },
  {
    label: "production start smoke",
    command: "npm.cmd",
    args: ["run", "smoke:start-production"],
  },
  {
    label: "deployed site smoke syntax",
    command: "node",
    args: ["--check", "scripts/smoke-deployed-site.mjs"],
  },
  {
    label: "launch course checker syntax",
    command: "node",
    args: ["--check", "scripts/check-launch-courses.mjs"],
  },
  {
    label: "launch transfer planner syntax",
    command: "node",
    args: ["--check", "scripts/prepare-launch-course-transfer.mjs"],
  },
  {
    label: "launch course status smoke",
    command: "npm.cmd",
    args: ["run", "smoke:prepare-launch-status"],
  },
  {
    label: "frontend smoke",
    command: "npm.cmd",
    args: ["run", "smoke:http"],
  },
  {
    label: "portal auth smoke",
    command: "npm.cmd",
    args: ["run", "smoke:portal-auth"],
  },
  {
    label: "login rate limit smoke",
    command: "npm.cmd",
    args: ["run", "smoke:login-rate-limit"],
  },
  {
    label: "teacher document import smoke",
    command: "npm.cmd",
    args: ["run", "smoke:import-teacher-docs"],
  },
  {
    label: "upload gap file import smoke",
    command: "npm.cmd",
    args: ["run", "smoke:import-gap-files"],
  },
  {
    label: "collection inbox smoke",
    command: "npm.cmd",
    args: ["run", "smoke:prepare-collection-inbox"],
  },
  {
    label: "courseware backup smoke",
    command: "npm.cmd",
    args: ["run", "smoke:backup-courseware"],
  },
  {
    label: "courseware restore smoke",
    command: "npm.cmd",
    args: ["run", "smoke:restore-backup"],
  },
  {
    label: "iSpring package batch import smoke",
    command: "npm.cmd",
    args: ["run", "smoke:import-ispring-packages"],
  },
  {
    label: "plan-only iSpring smoke",
    command: "npm.cmd",
    args: ["run", "smoke:plan-ispring"],
  },
  {
    label: "external resource smoke",
    command: "npm.cmd",
    args: ["run", "smoke:external-resources"],
  },
  {
    label: "admin smoke",
    command: "npm.cmd",
    args: ["run", "smoke:admin", "--", "--enabled-port", "8895"],
  },
];

for (const check of checks) {
  console.log(`\n== ${check.label} ==`);
  if (check.run) {
    try {
      check.run();
      console.log("OK");
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
    continue;
  }

  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`Release verification failed: ${check.label}`);
    process.exit(result.status || 1);
  }
}

console.log("\nRelease verification passed.");
