const mongoose = require("mongoose");

const runHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    projectName: { type: String, default: "" },
    datasetFilename: { type: String, required: true },
    datasetPath: { type: String, required: true },
    targetCol: { type: String, required: true },
    visualizations: { type: String, enum: ["yes", "no"], default: "no" },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      default: "pending",
    },
    report: { type: mongoose.Schema.Types.Mixed, default: null },
    reportPath: { type: String, default: null },
    modelPath: { type: String, default: null },
    pythonScriptPath: { type: String, default: null },
    plotPaths: { type: [String], default: [] },
    plotUrls: { type: [String], default: [] },
    featureColumns: { type: [String], default: [] },
    previewRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    metricsSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    currentStage: { type: String, default: "pending" },
    progressPct: { type: Number, default: 0 },
    stageMessage: { type: String, default: "" },
    progressUpdatedAt: { type: Date, default: null },
    logs: { type: String, default: "" },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RunHistory", runHistorySchema);
