/**
 * Standalone printer detail log parser. Zero dependencies on API or database.
 * Parses CMS-style detail log text: header metadata + Camera Data table.
 */

export type ParsedMetadata = {
  jobName: string;
  jobNumber: string;
  operator: string;
  jobStart: string | null;
  jobEnd: string | null;
};

export type LogRecord = {
  /** Header line (e.g. "Camera 1 Log File", "Camera 2 Log File") */
  logFileHeader: string | null;
  jobName: string;
  jobNumber: string;
  operator: string;
  jobStart: string | null;
  jobEnd: string | null;
  /** Value from the _Data column (e.g. Camera_1_Data, Camera_2_Data) */
  dataValue: string;
  /** Raw timestamp string from Date_Time_Stamp column */
  dateTimestamp: string;
  /** Derived status for display/bad-read count: "Bad Read" | "Good Piece" | etc. */
  status: string;
};


export type ParsedLog = {
  metadata: ParsedMetadata;
  records: LogRecord[];
  /** Header lines before the Camera Data table (e.g. title, "Detail Log File") */
  headerLines: string[];
  /** Footer lines after the data table (Total Reads, Bad Reads, Job End, etc.) */
  footerLines: string[];
  /** Parsed from footer "Sequence Reads: N" (summed across all blocks). Fallback: 0 */
  sequenceReadsFromFile: number;
};

const METADATA_KEYS = [
  "job name",
  "job number",
  "operator",
  "job start",
  "job end",
  "start time",
  "end time",
] as const;

/** Match a line like "Job Name: value" or "Job Name = value" */
function parseMetadataLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  const sep = trimmed.match(/^([^:=]+)[:=](.*)$/);
  if (!sep) return null;
  const key = sep[1].trim().toLowerCase();
  const value = sep[2].trim();
  if (!value) return null;
  const normalized = METADATA_KEYS.find((k) => key.includes(k) || k.includes(key));
  if (normalized) {
    if (normalized === "start time") return { key: "job start", value };
    if (normalized === "end time") return { key: "job end", value };
    return { key: normalized, value };
  }
  return null;
}

/** Check if line looks like the "Camera Data / Status / Date and Time Stamp" header (3-column format) */
function isCameraDataHeaderLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes("camera data") &&
    lower.includes("status") &&
    (lower.includes("date") || lower.includes("time"))
  );
}

/** Check if line is the two-column "Camera_N_Data,Date_Time_Stamp" header (new log format) */
function isCameraTwoColumnHeaderLine(line: string): boolean {
  return /^Camera_\d+_Data,Date_Time_Stamp$/i.test(line.trim());
}

/** Check if line is "Camera N Log File" (e.g. "Camera 1 Log File", "Camera 2 Log File") - store in log_file_header */
function isCameraLogFileHeaderLine(line: string): boolean {
  return /^Camera\s+\d+\s+Log\s+File$/i.test(line.trim());
}

function isTableHeaderLine(line: string): boolean {
  return isCameraDataHeaderLine(line) || isCameraTwoColumnHeaderLine(line);
}

type BlockMetadata = {
  logFileHeader: string | null;
  jobName: string;
  jobNumber: string;
  operator: string;
  jobStart: string | null;
  jobEnd: string | null;
};

/** Collect block metadata by scanning backwards from lineIndex for "Camera N Log File" and metadata lines */
function collectBlockMetadata(lines: string[], lineIndex: number): BlockMetadata {
  const out: BlockMetadata = {
    logFileHeader: null,
    jobName: "",
    jobNumber: "",
    operator: "",
    jobStart: null,
    jobEnd: null,
  };
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    if (isCameraLogFileHeaderLine(line)) out.logFileHeader = t;
    const parsed = parseMetadataLine(line);
    if (parsed) {
      if (parsed.key === "job name") out.jobName = parsed.value;
      else if (parsed.key === "job number") out.jobNumber = parsed.value;
      else if (parsed.key === "operator") out.operator = parsed.value;
      else if (parsed.key === "job start") out.jobStart = parsed.value;
      else if (parsed.key === "job end") out.jobEnd = parsed.value;
    }
  }
  return out;
}

/** Footer lines that end the data table; do not treat as data rows */
const FOOTER_PATTERNS = [
  /^\s*total\s+reads\s*:/i,
  /^\s*bad\s+reads\s*:/i,
  /^\s*repaired\s+bad\s+reads\s*:/i,
  /^\s*sequence\s+reads\s*:/i,
  /^\s*sequence\s+errors\s*:/i,
  /^\s*repaired\s+sequence\s+errors\s*:/i,
  /^\s*job\s+end\s*:/i,
];

function isFooterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return FOOTER_PATTERNS.some((p) => p.test(trimmed));
}

/** Parse "Sequence Reads: N" from a footer line. Returns the number or null. */
function parseSequenceReadsFromLine(line: string): number | null {
  const match = line.trim().match(/^\s*Sequence\s+Reads\s*:\s*(\d+)\s*$/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a two-column comma-separated data row: "Camera_Data,Date_Time_Stamp".
 * Status is derived: "Bad Read" if cameraData is "Bad_Read", else "Good Piece".
 */
function splitDataRowTwoColumn(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(",");
  if (idx === -1) return null;
  const cameraData = trimmed.slice(0, idx).trim();
  const timestamp = trimmed.slice(idx + 1).trim();
  if (!cameraData || !timestamp) return null;
  if (!looksLikeTimestamp(timestamp)) return null;
  const status = cameraData === "Bad_Read" ? "Bad Read" : "Good Piece";
  return [cameraData, status, timestamp];
}

/**
 * Split a data line by tab or multiple spaces (preserving single spaces inside fields if needed).
 * Expected: cameraData, status, timestamp (timestamp may contain a space for date time).
 * Sample format uses multiple tabs between columns (e.g. "000031\t\tGood Piece\t\t02/05/2022 10:12:14").
 */
function splitDataRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Tab-separated: filter empty segments from multiple tabs, then camera = first, timestamp = last, status = middle
  if (trimmed.includes("\t")) {
    const parts = trimmed.split(/\t/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const cameraData = parts[0];
      const timestamp = parts[parts.length - 1];
      const status = parts.slice(1, -1).join(" ").trim();
      return [cameraData, status || "Unknown", timestamp];
    }
    return null;
  }
  // Space-separated: last two "words" can be time (HH:mm:ss) and date is before that (MM/DD/YYYY)
  // So we need to split by 2+ spaces to get columns
  const parts = trimmed.split(/\s{2,}/);
  if (parts.length >= 3) return parts.map((p) => p.trim()).filter(Boolean);
  // Try single space split; timestamp is typically "MM/DD/YYYY HH:mm:ss" so 3 segments: camera, status, "date time"
  const bySpace = trimmed.split(/\s+/);
  if (bySpace.length >= 3) {
    const camera = bySpace[0];
    const status = bySpace.slice(1, -2).join(" "); // "Good Piece" or "Bad Read"
    const timestamp = bySpace.slice(-2).join(" "); // "02/05/2022 10:12:14"
    if (/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}$/.test(timestamp))
      return [camera, status || bySpace[1], timestamp];
  }
  return null;
}

/** Heuristic: does the third column look like a date/time? */
function looksLikeTimestamp(s: string): boolean {
  return /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s);
}

/**
 * Parse log timestamp string (e.g. "02/13/2026 10:27:38" or "01/22/2026 9:27:23") to ISO string for DB.
 * Returns null if not parseable.
 */
export function parseLogTimestampToISO(s: string | null): string | null {
  if (!s || !s.trim()) return null;
  const trimmed = s.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, month, day, year, hour, min, sec] = m;
  const d = new Date(
    parseInt(year!, 10),
    parseInt(month!, 10) - 1,
    parseInt(day!, 10),
    parseInt(hour!, 10),
    parseInt(min!, 10),
    parseInt(sec!, 10),
  );
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Returns true if the record represents a bad read (e.g. dataValue "Bad_Read", or status containing "bad read").
 * Use this when computing bad_reads so the UI matches the file's Bad Reads count.
 */
export function isBadReadRecord(r: LogRecord): boolean {
  const status = r.status.toLowerCase();
  const data = r.dataValue.toLowerCase();
  return (
    status.includes("bad read") ||
    status.includes("br removed") ||
    data === "bad_read" ||
    data.includes("bad read")
  );
}

/**
 * Parse raw detail log file text into structured metadata and records.
 * Supports:
 * - New format: "Camera_1_Data,Date_Time_Stamp" (two columns; status derived: Bad_Read → "Bad Read", else "Good Piece").
 * - Legacy format: "Camera Data / Status / Date and Time Stamp" (tab or space separated).
 * - Multiple job blocks in one file (all records merged; metadata from first block).
 */
export function parseDetailLog(rawText: string): ParsedLog {
  const lines = rawText.split(/\r?\n/);
  const metadata: ParsedMetadata = {
    jobName: "",
    jobNumber: "",
    operator: "",
    jobStart: null,
    jobEnd: null,
  };

  // First pass: collect first block's metadata and find all table header indices.
  const tableStartIndices: { index: number; twoColumn: boolean }[] = [];
  let firstTableIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseMetadataLine(line);
    if (parsed) {
      if (parsed.key === "job name") metadata.jobName = parsed.value;
      else if (parsed.key === "job number") metadata.jobNumber = parsed.value;
      else if (parsed.key === "operator") metadata.operator = parsed.value;
      else if (parsed.key === "job start") metadata.jobStart = parsed.value;
      else if (parsed.key === "job end") metadata.jobEnd = parsed.value;
      continue;
    }
    if (isCameraTwoColumnHeaderLine(line)) {
      if (firstTableIndex === -1) firstTableIndex = i;
      tableStartIndices.push({ index: i, twoColumn: true });
    } else if (isCameraDataHeaderLine(line)) {
      if (firstTableIndex === -1) firstTableIndex = i;
      tableStartIndices.push({ index: i, twoColumn: false });
    }
  }

  const records: LogRecord[] = [];
  const headerLines: string[] = [];
  const footerLines: string[] = [];
  let sequenceReadsFromFile = 0;

  if (firstTableIndex >= 0) {
    for (let i = 0; i < firstTableIndex; i++) {
      const t = lines[i].trim();
      if (t && !parseMetadataLine(lines[i])) headerLines.push(t);
    }
  }

  for (const { index: tableStartIndex, twoColumn } of tableStartIndices) {
    const block = collectBlockMetadata(lines, tableStartIndex);
    const recordsBeforeBlock = records.length;
    let footerStart = -1;
    for (let i = tableStartIndex + 1; i < lines.length; i++) {
      if (isFooterLine(lines[i])) {
        footerStart = i;
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          const line = lines[j];
          const jobEndMatch = line.match(/\bJob\s+End\s*:\s*(.+)/i);
          if (jobEndMatch) block.jobEnd = jobEndMatch[1].trim();
          const seqReads = parseSequenceReadsFromLine(line);
          if (seqReads !== null) sequenceReadsFromFile += seqReads;
        }
        break;
      }
      const trimmed = lines[i].trim();
      if (!trimmed) continue;

      const parts = twoColumn ? splitDataRowTwoColumn(lines[i]) : splitDataRow(lines[i]);
      if (!parts || parts.length < 3) continue;
      const [dataVal, status, dateTs] = parts;
      if (!dataVal || !dateTs) continue;
      if (!looksLikeTimestamp(dateTs)) continue;
      records.push({
        logFileHeader: block.logFileHeader,
        jobName: block.jobName,
        jobNumber: block.jobNumber,
        operator: block.operator,
        jobStart: block.jobStart,
        jobEnd: block.jobEnd,
        dataValue: dataVal,
        dateTimestamp: dateTs,
        status: status || "Unknown",
      });
    }
    if (records.length === recordsBeforeBlock) {
      records.push({
        logFileHeader: block.logFileHeader,
        jobName: block.jobName,
        jobNumber: block.jobNumber,
        operator: block.operator,
        jobStart: block.jobStart,
        jobEnd: block.jobEnd,
        dataValue: "",
        dateTimestamp: "",
        status: "Unknown",
      });
    }
    if (footerStart >= 0 && footerLines.length === 0) {
      for (let i = footerStart; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t) footerLines.push(t);
      }
    }
  }

  const hasMetadata = !!(metadata.jobName || metadata.jobNumber || metadata.operator || metadata.jobStart || metadata.jobEnd);
  const hasLogFileHeader = headerLines.some((line) => isCameraLogFileHeaderLine(line));
  if (records.length === 0 && (hasMetadata || hasLogFileHeader)) {
    const logFileHeader = headerLines.find((line) => isCameraLogFileHeaderLine(line)) ?? null;
    records.push({
      logFileHeader,
      jobName: metadata.jobName,
      jobNumber: metadata.jobNumber,
      operator: metadata.operator,
      jobStart: metadata.jobStart,
      jobEnd: metadata.jobEnd,
      dataValue: "",
      dateTimestamp: "",
      status: "Unknown",
    });
  }

  return { metadata, records, headerLines, footerLines, sequenceReadsFromFile };
}
