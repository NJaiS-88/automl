const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

function getPythonCommand() {
  if (process.env.PYTHON_EXECUTABLE) {
    return {
      command: process.env.PYTHON_EXECUTABLE,
      prefixArgs: [],
    };
  }

  // On Windows, the py launcher is typically available even when "python" is not.
  if (process.platform === "win32") {
    return {
      command: "py",
      prefixArgs: ["-3"],
    };
  }

  return {
    command: "python3",
    prefixArgs: [],
  };
}

function spawnPythonProcess(args, projectRoot) {
  const { command, prefixArgs } = getPythonCommand();
  return spawn(command, [...prefixArgs, ...args], {
    cwd: projectRoot,
    env: process.env,
  });
}

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
  onProgress = null,
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

    const pythonProcess = spawnPythonProcess(args, projectRoot);

    let stdout = "";
    let stderr = "";
    let settled = false;

    pythonProcess.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("PROGRESS:")) continue;
        const raw = line.slice("PROGRESS:".length).trim();
        try {
          const progressPayload = JSON.parse(raw);
          if (typeof onProgress === "function") {
            Promise.resolve(onProgress(progressPayload)).catch(() => {
              // ignore progress callback failures; main pipeline should continue
            });
          }
        } catch (_e) {
          // ignore malformed progress lines
        }
      }
    });

    pythonProcess.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    pythonProcess.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Unable to start Python process. Set PYTHON_EXECUTABLE in backend/.env if needed. Details: ${err.message}`
        )
      );
    });

    pythonProcess.on("close", (code) => {
      if (settled) return;
      settled = true;
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
    const generatedDir = path.join(projectRoot, "backend", "generated");
    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }
    const scriptPath = path.join(__dirname, "../../python/predict_api.py");
    const payloadPath = path.join(generatedDir, `tmp_predict_payload_${randomUUID()}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf-8");

    const args = [scriptPath, "--model-path", modelPath, "--payload-path", payloadPath];
    const pythonProcess = spawnPythonProcess(args, projectRoot);

    let stdout = "";
    let stderr = "";
    let settled = false;
    pythonProcess.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    pythonProcess.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    pythonProcess.on("error", (err) => {
      if (settled) return;
      settled = true;
      try {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      } catch (_e) {
        // ignore cleanup errors
      }
      reject(
        new Error(
          `Unable to start Python process. Set PYTHON_EXECUTABLE in backend/.env if needed. Details: ${err.message}`
        )
      );
    });

    pythonProcess.on("close", (code) => {
      if (settled) return;
      settled = true;
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

function runPythonVisualization({ projectRoot, datasetPath, payload, runId }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../../python/generate_visualizations_api.py");
    const payloadPath = path.join(
      projectRoot,
      "backend",
      "generated",
      `tmp_viz_payload_${runId}.json`
    );
    const outputDir = path.join(
      projectRoot,
      "backend",
      "generated",
      `${runId}-custom-viz-${Date.now()}`
    );
    fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf-8");

    const args = [
      scriptPath,
      "--dataset-path",
      datasetPath,
      "--payload-path",
      payloadPath,
      "--output-dir",
      outputDir,
    ];
    const pythonProcess = spawnPythonProcess(args, projectRoot);

    let stdout = "";
    let stderr = "";
    let settled = false;
    pythonProcess.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    pythonProcess.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    pythonProcess.on("error", (err) => {
      if (settled) return;
      settled = true;
      try {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      } catch (_e) {
        // ignore cleanup errors
      }
      reject(
        new Error(
          `Unable to start Python process. Set PYTHON_EXECUTABLE in backend/.env if needed. Details: ${err.message}`
        )
      );
    });

    pythonProcess.on("close", (code) => {
      if (settled) return;
      settled = true;
      try {
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      } catch (_e) {
        // ignore cleanup errors
      }
      if (code !== 0) {
        reject(new Error(stderr || stdout || "Visualization generation failed."));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (_err) {
        reject(new Error(`Invalid visualization output:\n${stdout}\n${stderr}`));
      }
    });
  });
}

module.exports = { runPythonPipeline, runPythonPredict, runPythonVisualization };
