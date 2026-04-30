const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function parseLastJsonObject(rawOutput) {
  const lines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch (_e) {
      // keep searching
    }
  }

  const startIdx = rawOutput.lastIndexOf("{");
  if (startIdx >= 0) {
    const tail = rawOutput.slice(startIdx).trim();
    try {
      return JSON.parse(tail);
    } catch (_e) {
      // ignored
    }
  }
  return null;
}

function runPythonPipeline({
  projectRoot,
  datasetPath,
  targetCol,
  runId,
  visualizations = "no",
}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../../python/run_pipeline_api.py");
    const args = [
      scriptPath,
      "--project-root",
      projectRoot,
      "--dataset-path",
      datasetPath,
      "--target-col",
      targetCol,
      "--run-id",
      runId,
      "--visualizations",
      visualizations,
    ];

    const pythonProcess = spawn("python", args, {
      cwd: projectRoot,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    pythonProcess.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || "Python pipeline execution failed."));
        return;
      }
      try {
        const parsed = parseLastJsonObject(stdout);
        if (!parsed) {
          throw new Error("Could not locate final JSON payload in pipeline output.");
        }
        resolve({ ...parsed, logs: stderr });
      } catch (_err) {
        reject(
          new Error(`Unable to parse pipeline output. Raw output:\n${stdout}\n${stderr}`)
        );
      }
    });
  });
}

function runPythonPredict({ projectRoot, modelPath, payload }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../../python/predict_api.py");
    const payloadPath = path.join(
      projectRoot,
      "backend",
      "generated",
      "tmp_predict_payload.json"
    );
    fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf-8");

    const args = [scriptPath, "--model-path", modelPath, "--payload-path", payloadPath];
    const pythonProcess = spawn("python", args, {
      cwd: projectRoot,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    pythonProcess.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    pythonProcess.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    pythonProcess.on("close", (code) => {
      try {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      } catch (_e) {
        // ignore cleanup errors
      }
      if (code !== 0) {
        reject(new Error(stderr || stdout || "Prediction failed."));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (_err) {
        reject(new Error(`Invalid prediction output:\n${stdout}\n${stderr}`));
      }
    });
  });
}

module.exports = { runPythonPipeline, runPythonPredict };
