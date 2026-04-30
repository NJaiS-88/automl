const fs = require("fs");
const { parse } = require("csv-parse/sync");

function readCsvPreview(filePath, maxRows = 30) {
  const content = fs.readFileSync(filePath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  const previewRows = records.slice(0, maxRows);
  const columns = previewRows.length ? Object.keys(previewRows[0]) : [];
  return { columns, previewRows };
}

module.exports = { readCsvPreview };
