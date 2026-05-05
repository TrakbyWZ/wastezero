"use strict";

/**
 * Install or uninstall the upload watcher as a Windows Service (node-windows + WinSW).
 *
 * Run from the windows-upload-service directory, in an elevated Command Prompt or PowerShell.
 *
 * Production (default): copies runtime files to Program Files and registers the service there:
 *   npm run install-service
 *   npm run uninstall-service
 *
 * Development / repo-local install (previous behavior):
 *   npm run install-service:dev
 *   npm run uninstall-service:dev
 *   npm run install-service -- --local
 *
 * Optional service display name:
 *   node scripts/install-service.js install MyCustomName
 *   node scripts/install-service.js uninstall MyCustomName --local
 *
 * Override production folder:
 *   set WASTEZERO_UPLOAD_INSTALL_PATH=D:\Apps\WasteZeroUpload
 *
 * Legacy: a single argument is treated as the service name for a **local** install:
 *   node scripts/install-service.js MyCustomName
 */

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

if (process.platform !== "win32") {
  console.error("This script only runs on Windows.");
  process.exit(1);
}

const { Service } = require("node-windows");

const defaultServiceName = "WasteZeroUpload";
const repoRoot = path.resolve(__dirname, "..");

/** Files required at runtime (no tests, no repo-only tooling). */
const FILES_TO_COPY = [
  "index.js",
  "load-config.js",
  "logger.js",
  "retry.js",
  "state.js",
  "package.json",
  "package-lock.json",
  "config.example.json",
];

function getProductionInstallRoot() {
  if (process.env.WASTEZERO_UPLOAD_INSTALL_PATH) {
    return path.resolve(process.env.WASTEZERO_UPLOAD_INSTALL_PATH);
  }
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  return path.join(pf, "WasteZero", "WindowsUploadService");
}

function resolveInstallRoot(useLocal) {
  if (useLocal) return repoRoot;
  return getProductionInstallRoot();
}

function parseArgs(argv) {
  const tokens = argv.slice(2);
  const useLocal = tokens.includes("--local");
  const filtered = tokens.filter((t) => t !== "--local");

  if (filtered.length === 0) {
    return { cmd: "install", serviceName: defaultServiceName, useLocal };
  }
  if (filtered[0] === "install") {
    return {
      cmd: "install",
      serviceName: filtered[1] || defaultServiceName,
      useLocal,
    };
  }
  if (filtered[0] === "uninstall") {
    return {
      cmd: "uninstall",
      serviceName: filtered[1] || defaultServiceName,
      useLocal,
    };
  }
  return { cmd: "install", serviceName: filtered[0], useLocal: true };
}

function copyRuntimeFiles(sourceRoot, destRoot) {
  fs.mkdirSync(destRoot, { recursive: true });
  for (const name of FILES_TO_COPY) {
    const src = path.join(sourceRoot, name);
    const dst = path.join(destRoot, name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required file for install: ${src}`);
    }
    fs.copyFileSync(src, dst);
  }
}

function npmCiOmitDev(destRoot) {
  console.log(`Running npm ci --omit=dev in:\n  ${destRoot}`);
  const r = spawnSync("npm", ["ci", "--omit=dev"], {
    cwd: destRoot,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`npm ci --omit=dev failed with exit code ${r.status}`);
  }
}

function warnIfMissingConfig(destRoot) {
  const cfg = path.join(destRoot, "config.json");
  if (!fs.existsSync(cfg)) {
    console.warn(
      "\nNo config.json in the install folder yet. Copy config.example.json to config.json " +
        "(or use .env / system environment variables), edit settings, then restart the service.\n",
    );
  }
}

function deployProductionPayloadIfNeeded(useLocal, installRoot) {
  if (useLocal) return;

  const sameFolder =
    path.resolve(installRoot).toLowerCase() === path.resolve(repoRoot).toLowerCase();
  if (sameFolder) {
    console.error(
        "Production install path resolves to this repo folder. Use a dedicated folder:\n" +
        "  Default: %ProgramFiles%\\WasteZero\\WindowsUploadService\n" +
        "Or use repo-local install: npm run install-service:dev\n" +
        "If WASTEZERO_UPLOAD_INSTALL_PATH is set, point it outside the repo clone.",
    );
    process.exit(1);
  }

  console.log(`Deploying service files to:\n  ${installRoot}`);
  copyRuntimeFiles(repoRoot, installRoot);
  npmCiOmitDev(installRoot);
  warnIfMissingConfig(installRoot);
}

function createService(serviceName, installRoot) {
  const entryScript = path.join(installRoot, "index.js");
  if (!fs.existsSync(entryScript)) {
    throw new Error(`Entry script not found: ${entryScript}`);
  }

  const logsDir = path.join(installRoot, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  return new Service({
    name: serviceName,
    description:
      "Watches printer log directories and uploads .txt/.csv files to the WasteZero ingest API.",
    script: entryScript,
    workingDirectory: installRoot,
    logpath: logsDir,
    stopparentfirst: true,
  });
}

function main() {
  const { cmd, serviceName, useLocal } = parseArgs(process.argv);
  const installRoot = resolveInstallRoot(useLocal);

  if (cmd === "install") {
    try {
      deployProductionPayloadIfNeeded(useLocal, installRoot);
    } catch (e) {
      console.error(e && e.message ? e.message : e);
      process.exit(1);
    }

    const svc = createService(serviceName, installRoot);

    svc.on("install", () => {
      console.log(`Service "${serviceName}" installed. Starting…`);
      svc.start();
    });
    svc.on("alreadyinstalled", () => {
      console.error(
        `Service "${serviceName}" is already installed. Stop it from Services.msc, or run:\n` +
          `  npm run uninstall-service${useLocal ? ":dev" : ""}\n` +
          `Or remove the "daemon" folder under:\n  ${installRoot}`,
      );
      process.exit(1);
    });
    svc.on("invalidinstallation", () => {
      console.error(
        'Service metadata looks corrupted. Try:\n' +
          `  npm run uninstall-service${useLocal ? ":dev" : ""}\n` +
          `Or remove the "daemon" folder under:\n  ${installRoot}`,
      );
      process.exit(1);
    });
    svc.on("start", () => {
      console.log(`Service "${serviceName}" is running.`);
      console.log(`Working directory: ${installRoot}`);
      process.exit(0);
    });
    svc.on("error", (err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });

    const mode = useLocal ? "repo-local (--local)" : `production (${installRoot})`;
    console.log(
      `Installing Windows service "${serviceName}" (${mode}, Administrator required)…`,
    );
    svc.install();
    return;
  }

  const svc = createService(serviceName, installRoot);

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

  const mode = useLocal ? "repo-local (--local)" : `production (${installRoot})`;
  console.log(`Uninstalling Windows service "${serviceName}" (${mode})…`);
  svc.uninstall();
}

main();
