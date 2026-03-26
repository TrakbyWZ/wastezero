"use strict";

/**
 * Helper to install the watcher as a Windows Service using NSSM (Non-Sucking Service Manager).
 * Run from the windows-upload-service directory: node scripts/install-service.js
 *
 * Prerequisites:
 * 1. Download NSSM from https://nssm.cc/download and extract it.
 * 2. Add the nssm executable (win64 or win32) to your PATH, or set NSSM_HOME to its directory.
 *
 * Usage:
 *   node scripts/install-service.js [serviceName]
 * Default service name: WasteZeroUpload
 */

const path = require("path");
const fs = require("fs");

const defaultServiceName = "WasteZeroUpload";
const serviceName = process.argv[2] || defaultServiceName;

const scriptDir = path.resolve(__dirname, "..");
const nodeExe = process.execPath;
const entryScript = path.join(scriptDir, "index.js");

if (!fs.existsSync(entryScript)) {
  console.error("Entry script not found:", entryScript);
  process.exit(1);
}

const nssmHome = process.env.NSSM_HOME || "nssm";
const nssmExe = path.isAbsolute(nssmHome) ? path.join(nssmHome, "nssm.exe") : "nssm";

const commands = [
  `# Install the service (run from an elevated Command Prompt or PowerShell):`,
  `"${nssmExe}" install ${serviceName} "${nodeExe}" "${entryScript}"`,
  ``,
  `# Set working directory so config.json and .env are found:`,
  `"${nssmExe}" set ${serviceName} AppDirectory "${scriptDir}"`,
  ``,
  `# Optional: redirect stdout/stderr to log files`,
  `"${nssmExe}" set ${serviceName} AppStdout "${path.join(scriptDir, "logs", "service-stdout.log")}"`,
  `"${nssmExe}" set ${serviceName} AppStderr "${path.join(scriptDir, "logs", "service-stderr.log")}"`,
  `"${nssmExe}" set ${serviceName} AppRotateFiles 1`,
  ``,
  `# Start the service:`,
  `"${nssmExe}" start ${serviceName}`,
  ``,
  `# Useful NSSM commands:`,
  `#   nssm status ${serviceName}   - check status`,
  `#   nssm stop ${serviceName}    - stop service`,
  `#   nssm remove ${serviceName}  - remove service (confirm)`,
];

console.log(commands.join("\n"));
