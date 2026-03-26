/**
 * Standalone test for LogParserLib (lib/log-parser.ts).
 * Run with: npx tsx scripts/test-log-parser.ts
 */

import { parseDetailLog, isBadReadRecord } from "../lib/log-parser";
import * as fs from "fs";
import * as path from "path";

const sample = `
Job Name: Sample Print Run
Job Number: JOB-2022-001
Operator: John Doe
Job Start: 02/05/2022 08:00:00
Job End: 02/05/2022 10:30:00

Camera Data	Status	Date and Time Stamp
000031	Good Piece	02/05/2022 10:12:14
000032	Bad Read	02/05/2022 10:12:15
000033	Good Piece	02/05/2022 10:12:16
`;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
  console.log("OK  ", message);
}

const result = parseDetailLog(sample);

assert(result.metadata.jobName === "Sample Print Run", "job name");
assert(result.metadata.jobNumber === "JOB-2022-001", "job number");
assert(result.metadata.operator === "John Doe", "operator");
assert(result.metadata.jobStart !== null, "job start present");
assert(result.metadata.jobEnd !== null, "job end present");
assert(result.records.length === 3, "three records");
assert(result.records[0].dataValue === "000031", "first data value");
assert(result.records[0].status === "Good Piece", "first status");
assert(result.records[0].dateTimestamp === "02/05/2022 10:12:14", "first date timestamp");
assert(result.records[1].status === "Bad Read", "bad read status preserved");

// Multi-tab format (as in cms-printer-sample-data.txt): multiple tabs between columns
const multiTabSample = `
Job Name: 1
Job Number: 2
Operator: 2
Job Start: 02/05/2022 10:11:21

Camera Data	Status			Date and Time Stamp
000031		Good Piece		02/05/2022 10:12:14
Bad Read	BR Removed		02/05/2022 10:13:31

Total Reads: 2
Job End: 02/05/2022 10:13:42
`;
const result2 = parseDetailLog(multiTabSample);
assert(result2.metadata.jobName === "1", "multi-tab job name");
assert(result2.records.length >= 2, "multi-tab two data rows");
assert(result2.records[0].dataValue === "000031", "multi-tab first data value");
assert(result2.records[0].status === "Good Piece", "multi-tab first status");
assert(result2.records[0].dateTimestamp === "02/05/2022 10:12:14", "multi-tab first date timestamp");
assert(result2.records[1].dataValue === "Bad Read", "multi-tab bad read data value");
assert(result2.records[1].status === "BR Removed", "multi-tab bad read status");
assert(isBadReadRecord(result2.records[1]), "multi-tab BR Removed row is counted as bad read");

// New two-column format: Camera_1_Data,Date_Time_Stamp (status derived: Bad_Read → "Bad Read", else "Good Piece")
const twoColumnSample = `
WasteZero, Inc.
Camera 1 Log File
Job Name: MPSTest
Job Number: 0122261
Operator: Joe
Job Start: 01/22/2026 9:27:13

Camera_1_Data,Date_Time_Stamp
100000,01/22/2026 9:27:23
Bad_Read,01/22/2026 9:27:44
000001,01/22/2026 9:28:03

Total Reads: 3
Bad Reads: 1
Sequence Errors: 0
Job End: 01/22/2026 9:28:52
`;
const resultTwoCol = parseDetailLog(twoColumnSample);
assert(resultTwoCol.metadata.jobName === "MPSTest", "two-column job name");
assert(resultTwoCol.metadata.operator === "Joe", "two-column operator");
assert(resultTwoCol.records.length === 3, "two-column three records");
assert(resultTwoCol.records[0].dataValue === "100000" && resultTwoCol.records[0].status === "Good Piece", "two-column first row");
assert(resultTwoCol.records[1].dataValue === "Bad_Read" && resultTwoCol.records[1].status === "Bad Read", "two-column Bad_Read row");
assert(resultTwoCol.records[0].logFileHeader === "Camera 1 Log File", "two-column log file header");
assert(resultTwoCol.records[0].jobEnd === "01/22/2026 9:28:52", "two-column job end from footer");
assert(isBadReadRecord(resultTwoCol.records[1]), "two-column Bad_Read is bad read");

// Sample file (cms-printer-sample-data.txt): 26 total reads, 25 good, 1 bad; footer not in records
const samplePath = path.join(__dirname, "../sampledata/cms-printer-sample-data.txt");
if (fs.existsSync(samplePath)) {
  const sampleRaw = fs.readFileSync(samplePath, "utf8");
  const result3 = parseDetailLog(sampleRaw);
  const badCount = result3.records.filter(isBadReadRecord).length;
  assert(result3.records.length === 26, `sample file: 26 total records (got ${result3.records.length})`);
  assert(badCount === 1, `sample file: 1 bad read (got ${badCount})`);
  const badRecord = result3.records.find(isBadReadRecord);
  assert(badRecord != null && badRecord.dataValue === "Bad Read" && badRecord.status === "BR Removed", "sample file: bad record has Bad Read / BR Removed");
  const hasJobEndAsRecord = result3.records.some((r) => r.dataValue === "Job" && r.status === "End:");
  assert(!hasJobEndAsRecord, "sample file: Job End footer must not appear as a data record");
  assert(result3.footerLines.length > 0, "sample file: footer lines captured");
  assert(result3.footerLines.some((l) => /job\s+end/i.test(l)), "sample file: Job End in footer lines");
  console.log("OK  ", "sample file 26 total, 1 bad read, footer excluded");
} else {
  console.log("SKIP", "sampledata/cms-printer-sample-data.txt not found");
}

console.log("\nAll LogParserLib tests passed.");
process.exit(0);
