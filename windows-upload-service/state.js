"use strict";

const fs = require("fs");
const path = require("path");
const { runWithRetry } = require("./retry");

/**
 * State file stores which files have been attempted (upload success, fail, or skip).
 * Format: array of rows { path, filename, sentAt, status, errorMessage?, retryAfter? } for easy ingestion as a dataframe/table.
 * status: "SUCCESS" | "FAIL" | "SKIP". SUCCESS = uploaded. SKIP = already exists on server (duplicate filename), do not retry. FAIL = will retry after retryAfter.
 */

function getStatePath(stateFile) {
  return path.isAbsolute(stateFile) ? stateFile : path.join(__dirname, stateFile);
}

function normalizeRow(row, p, v) {
  const pathVal = p || (row && row.path);
  const filename = (v && typeof v.filename === "string") || (row && typeof row.filename === "string")
    ? (v ? v.filename : row.filename)
    : path.basename(pathVal);
  const sentAt = (v && typeof v.sentAt === "string") || (row && typeof row.sentAt === "string")
    ? (v ? v.sentAt : row.sentAt)
    : new Date().toISOString();
  const status = (row && (row.status === "SUCCESS" || row.status === "FAIL" || row.status === "SKIP")) ? row.status : "SUCCESS";
  const out = { path: pathVal, filename, sentAt, status };
  if (row && typeof row.errorMessage === "string") out.errorMessage = row.errorMessage;
  return out;
}

/**
 * Load state as array of rows. Migrates legacy formats (object or array without status) on read.
 * @returns {Array<{ path: string, filename: string, sentAt: string, status: "SUCCESS"|"FAIL", errorMessage?: string }>}
 */
function loadState(stateFile) {
  const filePath = getStatePath(stateFile);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = runWithRetry(() => {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    });
    if (Array.isArray(data)) {
      return data.map((row) => (row && (row.status === "SUCCESS" || row.status === "FAIL" || row.status === "SKIP") ? row : normalizeRow(row, row.path, null)));
    }
    // Migrate legacy object format to array
    return Object.entries(data).map(([p, v]) => normalizeRow(null, p, v));
  } catch {
    return [];
  }
}

function saveState(stateFile, rows) {
  const filePath = getStatePath(stateFile);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(rows, null, 2);
  runWithRetry(() => fs.writeFileSync(filePath, payload, "utf8"));
}

/**
 * True if this file has been successfully sent. FAIL rows are not considered "sent" so they can be retried after retryAfter.
 */
function isSent(stateFile, absolutePath) {
  const rows = loadState(stateFile);
  const key = path.normalize(absolutePath);
  const row = rows.find((r) => path.normalize(r.path) === key);
  return row ? row.status === "SUCCESS" : false;
}

/**
 * Get the state row for a path, or null if not found.
 * @returns {{ path: string, filename: string, sentAt: string, status: "SUCCESS"|"FAIL", errorMessage?: string, retryAfter?: string } | null}
 */
function getRow(stateFile, absolutePath) {
  const rows = loadState(stateFile);
  const key = path.normalize(absolutePath);
  return rows.find((r) => path.normalize(r.path) === key) || null;
}

/**
 * True if this file is eligible for an upload attempt: not in state, or FAIL with retryAfter in the past (or no retryAfter for legacy rows).
 * SUCCESS and SKIP (already exists on server) are not eligible.
 */
function isEligibleForUpload(stateFile, absolutePath) {
  const row = getRow(stateFile, absolutePath);
  if (!row) return true;
  if (row.status === "SUCCESS" || row.status === "SKIP") return false;
  if (row.status === "FAIL") {
    const retryAfter = row.retryAfter;
    if (!retryAfter) return true;
    return Date.now() >= new Date(retryAfter).getTime();
  }
  return true;
}

function markSent(stateFile, absolutePath, filename) {
  const rows = loadState(stateFile);
  const key = path.normalize(absolutePath);
  const idx = rows.findIndex((row) => path.normalize(row.path) === key);
  const entry = {
    path: key,
    filename: filename || path.basename(absolutePath),
    sentAt: new Date().toISOString(),
    status: "SUCCESS",
  };
  if (idx >= 0) rows[idx] = entry;
  else rows.push(entry);
  saveState(stateFile, rows);
}

/**
 * Record that the file already exists on the server (e.g. duplicate filename). Will not retry.
 */
function markSkipped(stateFile, absolutePath, filename, errorMessage) {
  const rows = loadState(stateFile);
  const key = path.normalize(absolutePath);
  const entry = {
    path: key,
    filename: filename || path.basename(absolutePath),
    sentAt: new Date().toISOString(),
    status: "SKIP",
    ...(errorMessage != null && errorMessage !== "" ? { errorMessage: String(errorMessage).slice(0, 1000) } : {}),
  };
  const idx = rows.findIndex((row) => path.normalize(row.path) === key);
  if (idx >= 0) rows[idx] = entry;
  else rows.push(entry);
  saveState(stateFile, rows);
}

/**
 * Record a failed upload. The file will be retried after retryAfterMs (default 60 seconds).
 * errorMessage is optional (e.g. HTTP status or exception message).
 * @param {number} [retryAfterMs=60000] - milliseconds after which to retry (default 60s)
 */
function markFailed(stateFile, absolutePath, filename, errorMessage, retryAfterMs = 60000) {
  const rows = loadState(stateFile);
  const key = path.normalize(absolutePath);
  const retryAfter = new Date(Date.now() + retryAfterMs).toISOString();
  const entry = {
    path: key,
    filename: filename || path.basename(absolutePath),
    sentAt: new Date().toISOString(),
    status: "FAIL",
    retryAfter,
    ...(errorMessage != null && errorMessage !== "" ? { errorMessage: String(errorMessage).slice(0, 1000) } : {}),
  };
  const idx = rows.findIndex((row) => path.normalize(row.path) === key);
  if (idx >= 0) rows[idx] = entry;
  else rows.push(entry);
  saveState(stateFile, rows);
}

/**
 * Ensure the state file and its directory exist (create empty [] if missing).
 * Call at startup so sent_files.json is created even before any successful upload.
 */
function ensureStateFile(stateFile) {
  const filePath = getStatePath(stateFile);
  if (fs.existsSync(filePath)) return;
  saveState(stateFile, []);
}

/**
 * Trim state file to limit size. Keeps newest records by sentAt.
 * Dropped paths may be retried if they appear again in the watch directory.
 * @param {string} stateFile
 * @param {{ maxRecords?: number, maxStateAgeDays?: number }} options - 0 means no limit
 */
function trimState(stateFile, options = {}) {
  const { maxRecords = 0, maxStateAgeDays = 0 } = options;
  if (maxRecords <= 0 && maxStateAgeDays <= 0) return;
  let rows = loadState(stateFile);
  if (rows.length === 0) return;
  const now = Date.now();
  const cutOffMs = maxStateAgeDays > 0 ? now - maxStateAgeDays * 24 * 60 * 60 * 1000 : 0;
  if (cutOffMs > 0) {
    rows = rows.filter((r) => r.sentAt && new Date(r.sentAt).getTime() >= cutOffMs);
  }
  if (maxRecords > 0 && rows.length > maxRecords) {
    rows = rows
      .slice()
      .sort((a, b) => (new Date(a.sentAt || 0)).getTime() - (new Date(b.sentAt || 0)).getTime())
      .slice(-maxRecords);
  }
  saveState(stateFile, rows);
}

module.exports = {
  loadState,
  saveState,
  isSent,
  isEligibleForUpload,
  getRow,
  markSent,
  markSkipped,
  markFailed,
  getStatePath,
  ensureStateFile,
  trimState,
};
