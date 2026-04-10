"use strict";

const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./load-config");
const logger = require("./logger");
const state = require("./state");

function validateDirectories(watchDirectories) {
  const invalid = [];
  const resolved = [];
  for (const dir of watchDirectories) {
    const resolvedPath = path.resolve(dir);
    try {
      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) invalid.push(dir);
      else resolved.push(resolvedPath);
    } catch (err) {
      logger.warn(`Watch path not accessible: ${dir}`, {
        code: err.code,
        message: err.message,
      });
      invalid.push(dir);
    }
  }
  if (invalid.length > 0) {
    throw new Error(`The following paths are not accessible or not directories: ${invalid.join(", ")}`);
  }
  return resolved;
}

function scanForLogFiles(directories) {
  const files = [];
  for (const dir of directories) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const lower = ent.name.toLowerCase();
        if (lower.endsWith(".txt") || lower.endsWith(".csv")) {
          files.push(path.join(dir, ent.name));
        }
      }
    } catch (e) {
      logger.warn(`Failed to read directory ${dir}`, { error: e.message });
    }
  }
  return files;
}

/**
 * Returns true if the API response body indicates the file already exists (duplicate filename / unique constraint).
 * Matches idx_unique_log_files_filename or generic duplicate key value messages from Postgres.
 * Handles both raw text and JSON { error: "..." } bodies.
 */
function isDuplicateFilenameError(responseBody) {
  if (!responseBody || typeof responseBody !== "string") return false;
  let text = responseBody;
  try {
    const parsed = JSON.parse(responseBody);
    if (parsed && typeof parsed.error === "string") text = parsed.error;
  } catch {
    // use raw body
  }
  const lower = text.toLowerCase();
  return (
    lower.includes("idx_unique_log_files_filename") ||
    lower.includes("duplicate key value") ||
    (lower.includes("unique constraint") && lower.includes("filename"))
  );
}

/**
 * Upload file to the log-files ingest API (POST /api/log-files/ingest).
 * Expects API_ENDPOINT to point at that URL and API_KEY to match LOG_FILES_INGEST_API_KEY on the server.
 * If vercelProtectionBypass is set, sends x-vercel-protection-bypass so Vercel deployment protection allows the request.
 */
async function uploadFile(apiEndpoint, apiKey, filePath, vercelProtectionBypass = "") {
  const content = fs.readFileSync(filePath, "utf8");
  const filename = path.basename(filePath);
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
  if (vercelProtectionBypass) {
    headers["x-vercel-protection-bypass"] = vercelProtectionBypass;
  }
  const res = await fetch(apiEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, filename }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

module.exports = { uploadFile, validateDirectories, scanForLogFiles, runCycle };

async function runCycle(config, resolvedDirs) {
  state.trimState(config.stateFile, {
    maxRecords: config.maxStateRecords,
    maxStateAgeDays: config.maxStateAgeDays,
  });
  const logFiles = scanForLogFiles(resolvedDirs);
  const toSend = logFiles.filter((fp) => state.isEligibleForUpload(config.stateFile, fp));

  logger.info("Poll cycle", {
    totalFiles: logFiles.length,
    alreadySent: logFiles.length - toSend.length,
    toUpload: toSend.length,
    files: toSend.length ? toSend.map((fp) => path.basename(fp)) : undefined,
  });

  for (const filePath of toSend) {
    logger.info("Attempting to upload", { file: filePath });
    try {
      const { ok, status, body } = await uploadFile(
        config.apiEndpoint,
        config.apiKey,
        filePath,
        config.vercelProtectionBypass || "",
      );
      if (ok || status === 200 || status === 201) {
        state.markSent(config.stateFile, filePath, path.basename(filePath));
        logger.info("Upload successful", { file: filePath, status });
      } else {
        const reason = body.slice(0, 200) || `HTTP ${status}`;
        if (isDuplicateFilenameError(body)) {
          state.markSkipped(config.stateFile, filePath, path.basename(filePath), reason);
          logger.info("File already exists on server (will not retry)", {
            file: filePath,
            status,
            reason,
          });
        } else {
          state.markFailed(config.stateFile, filePath, path.basename(filePath), reason, 60000);
          const isVercelAuth =
            status === 401 &&
            (body.includes("Authentication Required") || body.includes("vercel")) &&
            config.apiEndpoint.includes("vercel.app") &&
            !config.vercelProtectionBypass;
          logger.error("Upload failed (will retry in 60s)", {
            file: filePath,
            status,
            responseBody: body.slice(0, 500),
            reason,
            ...(isVercelAuth
              ? {
                  hint: "Vercel deployment protection is blocking this URL. Set vercelProtectionBypass in config (or VERCEL_PROTECTION_BYPASS in .env) to your project's Protection Bypass for Automation secret. See README.",
                }
              : {}),
          });
        }
      }
    } catch (e) {
      state.markFailed(config.stateFile, filePath, path.basename(filePath), e.message, 60000);
      logger.error("Upload error (will retry in 60s)", {
        file: filePath,
        error: e.message,
        stack: e.stack,
      });
    }
  }
}

function main() {
  let config;
  let resolvedDirs;

  try {
    config = loadConfig();
  } catch (e) {
    console.error("Configuration error:", e.message);
    process.exit(1);
  }

  logger.setLogDir(config.logDir);
  logger.setLogRotation(config.logMaxSizeBytes, config.logMaxBackups);
  state.ensureStateFile(config.stateFile);
  logger.info("Service starting", {
    watchDirectories: config.watchDirectories,
    apiEndpoint: config.apiEndpoint,
    pollingIntervalSeconds: config.pollingIntervalSeconds,
    stateFile: config.stateFile,
    logDir: config.logDir,
  });

  try {
    resolvedDirs = validateDirectories(config.watchDirectories);
  } catch (e) {
    logger.error("Startup validation failed", { error: e.message });
    process.exit(1);
  }

  const intervalMs = config.pollingIntervalSeconds * 1000;

  async function tick() {
    try {
      await runCycle(config, resolvedDirs);
    } catch (e) {
      logger.error("Poll cycle error", { error: e.message });
    }
    setTimeout(tick, intervalMs);
  }

  tick();
}

if (require.main === module) {
  main();
}
