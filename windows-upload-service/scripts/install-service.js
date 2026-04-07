"use strict";

/**
 * Install or uninstall the upload watcher as a Windows Service (node-windows + WinSW).
 *
 * Run from the windows-upload-service directory, in an elevated Command Prompt or PowerShell:
 *   npm run install-service
 *   npm run uninstall-service
 *
 * Optional service display name (default: WasteZeroUpload):
 *   node scripts/install-service.js install MyCustomName
 *   node scripts/install-service.js uninstall MyCustomName
 *
 * Legacy: a single argument is treated as the service name for install:
 *   node scripts/install-service.js MyCustomName
 */

const path = require("path");
const fs = require("fs");

if (process.platform !== "win32") {
  console.error("This script only runs on Windows.");
  process.exit(1);
}

const { Service } = require("node-windows");

const defaultServiceName = "WasteZeroUpload";
const scriptDir = path.resolve(__dirname, "..");
const entryScript = path.join(scriptDir, "index.js");

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.length === 0) {
    return { cmd: "install", serviceName: defaultServiceName };
  }
  if (rest[0] === "install") {
    return { cmd: "install", serviceName: rest[1] || defaultServiceName };
  }
  if (rest[0] === "uninstall") {
    return { cmd: "uninstall", serviceName: rest[1] || defaultServiceName };
  }
  return { cmd: "install", serviceName: rest[0] };
}

function createService(serviceName) {
  if (!fs.existsSync(entryScript)) {
    throw new Error(`Entry script not found: ${entryScript}`);
  }
  const logsDir = path.join(scriptDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  return new Service({
    name: serviceName,
    description:
      "Watches printer log directories and uploads .txt/.csv files to the WasteZero ingest API.",
    script: entryScript,
    workingDirectory: scriptDir,
    logpath: logsDir,
    stopparentfirst: true,
  });
}

function main() {
  const { cmd, serviceName } = parseArgs(process.argv);

  if (cmd === "install") {
    const svc = createService(serviceName);

    svc.on("install", () => {
      console.log(`Service "${serviceName}" installed. Starting…`);
      svc.start();
    });
    svc.on("alreadyinstalled", () => {
      console.error(
        `Service "${serviceName}" is already installed. Stop it from Services.msc, or run: npm run uninstall-service`
      );
      process.exit(1);
    });
    svc.on("invalidinstallation", () => {
      console.error(
        'Service metadata looks corrupted. Try: npm run uninstall-service\nOr remove the "daemon" folder in this directory and install again.'
      );
      process.exit(1);
    });
    svc.on("start", () => {
      console.log(`Service "${serviceName}" is running.`);
      process.exit(0);
    });
    svc.on("error", (err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });

    console.log(`Installing Windows service "${serviceName}" (Administrator required)…`);
    svc.install();
    return;
  }

  const svc = createService(serviceName);

  svc.on("stop", () => {
    console.log(`Service "${serviceName}" stopped.`);
  });
  svc.on("uninstall", () => {
    console.log(`Service "${serviceName}" uninstalled.`);
    process.exit(0);
  });
  svc.on("alreadyuninstalled", () => {
    console.log(`Service "${serviceName}" was not installed (nothing to remove).`);
    process.exit(0);
  });
  svc.on("error", (err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });

  console.log(`Uninstalling Windows service "${serviceName}"…`);
  svc.uninstall();
}

main();
