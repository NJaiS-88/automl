const fs = require("fs");
const { parse } = require("csv-parse");

function readCsvPreview(filePath, maxRows = 30) {
  return new Promise((resolve, reject) => {
    const previewRows = [];
    let columns = [];
    let settled = false;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
      trim: true,
    });

    parser.on("data", (record) => {
      if (!columns.length) columns = Object.keys(record);
      if (previewRows.length < maxRows) {
        previewRows.push(record);
      }
      if (previewRows.length >= maxRows && !settled) {
        settled = true;
        stream.destroy();
        parser.destroy();
        resolve({ columns, previewRows });
      }
    });

    parser.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    parser.on("end", () => {
      if (!settled) {
        settled = true;
        resolve({ columns, previewRows });
      }
    });

    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    stream.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    stream.pipe(parser);
  });
}

module.exports = { readCsvPreview };
