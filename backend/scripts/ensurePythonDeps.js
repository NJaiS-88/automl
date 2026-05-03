/**
 * One-shot install of backend Python deps (including Streamlit).
 * Loads backend/.env so PYTHON is honored.
 * On Windows, tries py -3.12 / -3.11 before py -3 to avoid broken builds on Python 3.13.
 */
const { execSync } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const reqFile = path.join(__dirname, "..", "requirements.txt");
const isWin = process.platform === "win32";

const pythonFromEnv = process.env.PYTHON?.trim();

function buildAttempts() {
  const quote = (p) => `"${p}"`;
  const cmd = (launcher) => `${launcher} -m pip install -r ${quote(reqFile)}`;

  const list = [];
  if (pythonFromEnv) {
    list.push(cmd(quote(pythonFromEnv)));
  }
  if (isWin) {
    list.push(`py -3.12 -m pip install -r "${reqFile}"`);
    list.push(`py -3.11 -m pip install -r "${reqFile}"`);
    list.push(`py -3.10 -m pip install -r "${reqFile}"`);
    list.push(`py -3 -m pip install -r "${reqFile}"`);
    list.push(`python -m pip install -r "${reqFile}"`);
    list.push(`python3 -m pip install -r "${reqFile}"`);
  } else {
    list.push(`python3 -m pip install -r "${reqFile}"`);
    list.push(`python -m pip install -r "${reqFile}"`);
  }
  return [...new Set(list)];
}

const attempts = buildAttempts();

let lastErr = null;
for (const cmd of attempts) {
  try {
    console.log("Running:", cmd);
    execSync(cmd, { stdio: "inherit", shell: true });
    console.log("Done.");
    process.exit(0);
  } catch (e) {
    lastErr = e;
  }
}
console.error("All attempts failed. Install Python 3.10–3.12 (recommended on Windows),");
console.error('set PYTHON in automl/backend/.env to that python.exe, then run:');
console.error(`  py -3.12 -m pip install -r "${reqFile}"`);
if (lastErr) console.error(lastErr.message);
process.exit(1);
