import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (!args.length) {
  console.error("Usage: node scripts/run-python-tool.mjs <script.py> [...args]");
  process.exit(2);
}

const explicit = process.env.PYTHON_BIN ? [[process.env.PYTHON_BIN]] : [];
const candidates = [
  ...explicit,
  process.platform === "win32" ? ["python"] : ["python3"],
  process.platform === "win32" ? ["py", "-3"] : ["python"],
];

let lastError = "";

for (const candidate of candidates) {
  const [command, ...baseArgs] = candidate;
  const result = spawnSync(command, [...baseArgs, ...args], {
    stdio: "inherit",
    shell: false,
  });

  if (!result.error) process.exit(result.status ?? 0);

  lastError = `${command}: ${result.error.message}`;
}

console.error(`Unable to find a working Python interpreter. ${lastError}`);
console.error("Set PYTHON_BIN to the Python executable path if needed.");
process.exit(127);
