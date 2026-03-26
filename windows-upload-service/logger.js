"use strict";

const fs = require("fs");
const path = require("path");
const { runWithRetry } = require("./retry");

let logDir = "logs";
let logMaxSizeBytes = 5 * 1024 * 1024;  // 5 MB
let logMaxBackups = 3;

function setLogDir(dir) {
  logDir = dir;
}

function setLogRotation(maxSizeBytes, maxBackups) {
  if (maxSizeBytes != null && maxSizeBytes > 0) logMaxSizeBytes = maxSizeBytes;
  if (maxBackups != null && maxBackups >= 0) logMaxBackups = maxBackups;
}

function ensureLogDir() {
  const full = path.isAbsolute(logDir) ? logDir : path.join(__dirname, logDir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  return full;
}

function rotateLogFile(logPath) {
  if (logMaxBackups < 1) {
    try { fs.unlinkSync(logPath); } catch { }
    return;
  }
  for (let i = logMaxBackups; i >= 1; i--) {
    const dst = `${logPath}.${i}`;
    const src = i === 1 ? logPath : `${logPath}.${i - 1}`;
    try {
      if (i === logMaxBackups && fs.existsSync(dst)) fs.unlinkSync(dst);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch { }
  }
}

function logLine(level, message, meta = null) {
  const ts = new Date().toISOString();
  const metaStr = meta != null ? ` ${JSON.stringify(meta)}` : "";
  const line = `${ts} [${level}] ${message}${metaStr}\n`;
  try {
    runWithRetry(() => {
      const dir = ensureLogDir();
      const file = path.join(dir, "service.log");
      if (logMaxSizeBytes > 0 && logMaxBackups >= 0 && fs.existsSync(file)) {
        const stat = fs.statSync(file);
        if (stat.size >= logMaxSizeBytes) rotateLogFile(file);
      }
      fs.appendFileSync(file, line);
    });
  } catch (e) {
    console.error(ts, level, message, meta);
    console.error("Log write failed (after retries):", e.message);
  }
}

function info(message, meta) {
  logLine("INFO", message, meta);
}

function error(message, meta) {
  logLine("ERROR", message, meta);
}

function warn(message, meta) {
  logLine("WARN", message, meta);
}

module.exports = {
  setLogDir,
  setLogRotation,
  info,
  error,
  warn,
};
