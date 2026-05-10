const path = require("path");
const fs = require("fs");

let cached;

/**
 * Resolve upload / generated directories. On Render, set DATA_DIR to a persistent
 * disk mount (e.g. /var/render/data) so files survive restarts.
 */
function resolveDataDirs() {
  if (cached) return cached;

  const dataDir = process.env.DATA_DIR?.trim();
  const explicitUploads = process.env.UPLOADS_DIR?.trim();
  const explicitGenerated = process.env.GENERATED_DIR?.trim();

  let uploadsDir;
  let generatedDir;

  if (dataDir) {
    uploadsDir = path.join(dataDir, "uploads");
    generatedDir = path.join(dataDir, "generated");
  } else {
    uploadsDir = explicitUploads || path.join(process.cwd(), "uploads");
    generatedDir = explicitGenerated || path.join(process.cwd(), "generated");
  }

  for (const d of [uploadsDir, generatedDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  cached = { uploadsDir, generatedDir };
  return cached;
}

function getUploadsDir() {
  return resolveDataDirs().uploadsDir;
}

function getGeneratedDir() {
  return resolveDataDirs().generatedDir;
}

module.exports = { resolveDataDirs, getUploadsDir, getGeneratedDir };
