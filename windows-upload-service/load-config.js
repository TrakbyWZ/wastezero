"use strict";

const fs = require("fs");
const path = require("path");

// Load .env if present (dotenv optional)
function loadEnv() {
  try {
    const dotenv = require("dotenv");
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  } catch {
    // dotenv not installed or .env missing
  }
}

/**
 * Load config from config.json and override with env vars.
 * @returns {{
 *   watchDirectories: string[],
 *   apiEndpoint: string,
 *   apiKey: string,
 *   vercelProtectionBypass?: string,
 *   pollingIntervalSeconds: number,
 *   stateFile: string,
 *   logDir: string,
 *   logMaxSizeBytes: number,
 *   logMaxBackups: number,
 *   maxStateRecords: number,
 *   maxStateAgeDays: number
 * }}
 */
function loadConfig() {
  loadEnv();

  const configPath = path.join(__dirname, "config.json");
  let config = {
    watchDirectories: [],
    apiEndpoint: "",
    apiKey: "",
    vercelProtectionBypass: "",
    pollingIntervalSeconds: 60,
    stateFile: "sent_files.json",
    logDir: "logs",
    logMaxSizeBytes: 5 * 1024 * 1024,  // 5 MB
    logMaxBackups: 3,
    maxStateRecords: 0,   // 0 = no limit
    maxStateAgeDays: 0,   // 0 = no limit
  };

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const fromFile = JSON.parse(raw);
      config = { ...config, ...fromFile };
    } catch (e) {
      throw new Error(`Invalid config.json: ${e.message}`);
    }
  }

  if (process.env.WATCH_DIRECTORIES) {
    try {
      config.watchDirectories = JSON.parse(process.env.WATCH_DIRECTORIES);
    } catch {
      config.watchDirectories = process.env.WATCH_DIRECTORIES.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (process.env.API_ENDPOINT) config.apiEndpoint = process.env.API_ENDPOINT;
  if (process.env.API_KEY) config.apiKey = process.env.API_KEY;
  if (process.env.VERCEL_PROTECTION_BYPASS) config.vercelProtectionBypass = process.env.VERCEL_PROTECTION_BYPASS;
  else if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) config.vercelProtectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (typeof config.vercelProtectionBypass !== "string") config.vercelProtectionBypass = "";
  else config.vercelProtectionBypass = config.vercelProtectionBypass.trim();
  if (process.env.POLLING_INTERVAL != null) config.pollingIntervalSeconds = parseInt(process.env.POLLING_INTERVAL, 10) || 60;
  if (process.env.STATE_FILE) config.stateFile = process.env.STATE_FILE;
  if (process.env.LOG_DIR) config.logDir = process.env.LOG_DIR;
  if (process.env.LOG_MAX_SIZE_BYTES != null) config.logMaxSizeBytes = parseInt(process.env.LOG_MAX_SIZE_BYTES, 10) || config.logMaxSizeBytes;
  if (process.env.LOG_MAX_BACKUPS != null) config.logMaxBackups = Math.max(0, parseInt(process.env.LOG_MAX_BACKUPS, 10));
  if (process.env.MAX_STATE_RECORDS != null) config.maxStateRecords = Math.max(0, parseInt(process.env.MAX_STATE_RECORDS, 10));
  if (process.env.MAX_STATE_AGE_DAYS != null) config.maxStateAgeDays = Math.max(0, parseInt(process.env.MAX_STATE_AGE_DAYS, 10));

  if (!Array.isArray(config.watchDirectories) || config.watchDirectories.length === 0) {
    throw new Error("At least one watch directory is required (watchDirectories in config.json or WATCH_DIRECTORIES in .env)");
  }
  if (!config.apiEndpoint || !config.apiKey) {
    throw new Error("apiEndpoint and apiKey are required (config.json or API_ENDPOINT and API_KEY in .env)");
  }
  if (config.pollingIntervalSeconds < 5) config.pollingIntervalSeconds = 5;

  return config;
}

module.exports = { loadConfig };
