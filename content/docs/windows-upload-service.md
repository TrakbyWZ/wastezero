# Windows Upload Service

This page covers the .NET worker that scans printer/export folders for `*.txt` / `*.csv` files and posts them to `/api/log-files/ingest`.

Use this together with [Local Development](./local-development.md) when testing end-to-end from a local Next.js app.

## What it does

- Runs as a .NET background worker (interactive via `dotnet run`, or installed as a Windows Service).
- Polls configured watch directories.
- Sends file content to `UploadService:ApiEndpoint` with `X-API-Key`.
- Stores upload outcomes in SQLite (`file_upload_state`) so reboots/restarts do not lose state.

## Install on Windows server

Typical choices:

1. **[Self-contained build from GitHub Actions](#download-self-contained-build-github-actions)** (recommended when the server should **not** install the .NET SDK or runtime).
2. **`Install-Service.ps1 -PublishAndCopy`** on a machine that has the **.NET SDK**, optionally with **`-SelfContained`** so the server still needs no separate runtime.
3. **Copy a publish folder** produced elsewhere, then run **`Install-Service.ps1`** without **`-PublishAndCopy`** (register/update service only).

---

### Download self-contained build (GitHub Actions)

The repository workflow **Build Windows Upload Service** (`.github/workflows/windows-upload-service.yml`) publishes a **self-contained** **win-x64** build: the **.NET 6 runtime is included** next to the executable, so production servers do not need the SDK or the shared .NET Desktop Runtime. The zip also includes **`Install-Service.ps1`** and **`Uninstall-Service.ps1`** next to the exe, plus a **`project-source`** folder (full **`WasteZero.WindowsUploadService`** project sources) so **`Install-Service.ps1 -PublishAndCopy`** can rebuild from the bundle when the **.NET SDK** is installed—pass **`-SelfContained`** to match CI output.

**Download**

1. Open the GitHub repository → **Actions**.
2. Select **Build Windows Upload Service**.
3. Open a successful run (runs on pushes to **`main`** that touch `windows-upload-service-dotnet/`, or use **Run workflow** for **workflow_dispatch**).
4. Under **Artifacts**, download **`WasteZero.WindowsUploadService-win-x64-self-contained`** (a zip file).

**Install**

1. On the Windows Server, unpack the zip so **`WasteZero.WindowsUploadService.exe`**, **`Install-Service.ps1`**, **`Uninstall-Service.ps1`**, **`project-source\`**, **`appsettings.json`**, DLLs, and runtime files all live in one folder—by default use:

   `C:\Program Files\WasteZero\WindowsUploadService`

   If the zip adds an extra directory layer, move the **contents** up so the exe, scripts, and **`project-source`** sit directly in the install folder.

2. Edit **`appsettings.json`** (`WatchDirectories`, **`UploadService:ApiEndpoint`**, **`UploadService:ApiKey`**, etc.).

3. Open **PowerShell as Administrator**, **cd** into that folder (the same directory as **`Install-Service.ps1`**).

   **Typical install (use the pre-built binaries):** register the service **without** **`-PublishAndCopy`**:

```powershell
cd "C:\Program Files\WasteZero\WindowsUploadService"
.\Install-Service.ps1
```

   **Rebuild from sources on this machine** (requires **.NET 6 SDK** on `PATH`): run **`Install-Service.ps1 -PublishAndCopy`**. The script picks **`project-source\WasteZero.WindowsUploadService.csproj`** automatically when it sits next to **`Install-Service.ps1`**. Use **`-SelfContained`** to publish a self-contained **win-x64** output like CI:

```powershell
cd "C:\Program Files\WasteZero\WindowsUploadService"
.\Install-Service.ps1 -PublishAndCopy -SelfContained
```

   If the service is **already installed**, run **`.\Uninstall-Service.ps1`** before **`Install-Service.ps1 -PublishAndCopy`** (the install script refuses to overwrite an existing service registration).

If you unpacked somewhere else, pass **`-InstallPath`** with that folder’s path.

For upgrades without recompiling, stop the service, replace the publish folder contents with a newly downloaded artifact, then start the service again (see [Resilience expectations](#resilience-expectations)).

---

### One-command install using .NET SDK on the server

Run one elevated command that publishes, copies to the install folder, and registers the Windows Service.

Open **PowerShell as Administrator**:

```powershell
cd windows-upload-service-dotnet\scripts
.\Install-Service.ps1 -PublishAndCopy
```

By default this uses:

- Install path: `C:\Program Files\WasteZero\WindowsUploadService`
- Publish config/runtime: `Release`, `win-x64`
- Framework-dependent publish (`--self-contained false`), which requires the **.NET 6 runtime** to be installed on that machine.

Use **`-SelfContained`** with **`-PublishAndCopy`** if you are publishing from the SDK on that machine but still want a **folder that bundles the runtime** (similar to the GitHub artifact, larger output).

**Recommended permanent install path**

Use a dedicated folder that only holds this publish output and runtime files—nothing else unpacks over it except deliberate upgrades:

`C:\Program Files\WasteZero\WindowsUploadService`

After **`Install-Service.ps1 -PublishAndCopy`** (or a manual copy), that folder should contain the published **`WasteZero.WindowsUploadService.exe`**, dependency assemblies, **`appsettings.json`**, and related runtime files—everything the worker needs next to the executable.

![Default install folder after publish: exe, DLLs, and appsettings under Program Files](/docs-images/win-upload-svc-appsettings.png)

Grant the **service account** **Modify** on that folder (SQLite DB, rotated logs, and optional settings updates live here). Keep backups or relocate heavy paths via config (`DatabasePath`, `LogDir`) if you prefer data on another volume—for example `D:\Data\WasteZero\upload_state.db` while the exe stays under Program Files.

Verify the executable exists before install:

```powershell
Test-Path "C:\Program Files\WasteZero\WindowsUploadService\WasteZero.WindowsUploadService.exe"
```

### Alternative: pre-publish on a different machine

If your server should not run the SDK build, prefer the **[GitHub Actions artifact](#download-self-contained-build-github-actions)** above, or:

1. Publish on a build/developer machine (`dotnet publish` with **`--self-contained true`** and **`-r win-x64`** if the server has no .NET runtime).
2. Copy the full publish output into the install folder on the server.
3. Run install on the server without the publish step:

```powershell
cd windows-upload-service-dotnet\scripts
.\Install-Service.ps1
```

Useful options:

- `-InstallPath` to override the default install folder (`C:\Program Files\WasteZero\WindowsUploadService`).
- `-PublishAndCopy` to run publish + copy inside the install script.
- `-ProjectPath`, `-PublishConfiguration`, `-Runtime`, `-SelfContained` to control publish behavior when using `-PublishAndCopy`.
- `-DelayedAutoStart` to start after other automatic services at boot.
- `-SkipFailureRecovery` if you do not want the script to configure automatic restart on process failure.

### Verify in Services (`services.msc`)

Open **Services** (Win+R → `services.msc`) and locate **WasteZero Windows Upload** (internal name **`WasteZeroUpload`** unless you changed **`-ServiceName`**).

A healthy install should show:

- **Status:** **Running** (after `Start-Service` / successful install script completion).
- **Startup Type:** **Automatic** by default. If you passed **`-DelayedAutoStart`**, Windows shows **Automatic (Delayed Start)**—still correct; the service starts shortly after boot.

![WasteZero Windows Upload in the Services list](/docs-images/win-upload-svc-services.png)

If Status is blank or shows **Stopped** right after install, fix configuration (for example empty **`UploadService:ApiKey`**) and check [Troubleshooting quick checks](#troubleshooting-quick-checks) before restarting the service.

## Where to find logs

The worker writes a rotating **file log** and also emits **Windows Event Log** entries.

### File log (`service.log`)

The log directory comes from **`UploadService:LogDir`** (default `logs`). It is resolved relative to the process **content root**, which is the folder containing **`WasteZero.WindowsUploadService.exe`** when installed from a publish folder.

Typical installed path:

`C:\Program Files\WasteZero\WindowsUploadService\logs\service.log`

When you run **`dotnet run`** locally, content root is under **`bin\Debug\net6.0-windows\`** (or Release), so with default `LogDir` you usually get:

`windows-upload-service-dotnet\src\WasteZero.WindowsUploadService\bin\Debug\net6.0-windows\logs\service.log`

Rotated files appear alongside `service.log` when **`LogMaxSizeBytes`** / **`LogMaxBackups`** are set in appsettings.

On startup the service logs **`DatabasePath`** and **`LogDir`** at Information level—check the latest lines there if you are unsure which paths resolved.

### Windows Event Viewer

Open **Event Viewer** → **Windows Logs** → **Application**. Look for source **`WasteZeroUpload`** (same entries surface alongside the file log for operators who monitor Event Viewer).

### Next.js / ingest side

Upload failures or validation errors from the HTTP API appear in the dev server terminal (for example `pnpm dev`) when pointing at a local app.

## Where is the executable?

When installed as a service, the binary lives in whatever folder you passed to **`Install-Service.ps1 -InstallPath`**:

`<InstallPath>\WasteZero.WindowsUploadService.exe`

Example:

`C:\Program Files\WasteZero\WindowsUploadService\WasteZero.WindowsUploadService.exe`

To confirm what Windows is running (default internal service name **`WasteZeroUpload`** unless you changed **`-ServiceName`**):

```powershell
sc.exe qc WasteZeroUpload
```

Inspect **`BINARY_PATH_NAME`** (quoted path to the exe). Alternatively:

```powershell
Get-CimInstance Win32_Service -Filter "Name='WasteZeroUpload'" | Select-Object Name, PathName
```

In **Task Manager** → **Details**, add the **Image path name** column to see the full path of the running process.

## Resilience expectations

- **Reboots:** service startup type is automatic (or delayed-auto), so it restarts after machine reboot.
- **Unexpected process failure:** install script configures Windows Recovery to restart after failures (unless skipped).
- **State durability:** SQLite keeps per-file outcome state on disk; files are retried after restart when appropriate.
- **Graceful stop behavior:** host shutdown timeout allows in-flight uploads time to complete before service stop.
- **App updates:** stop service, replace publish output, then start service again. Keep existing SQLite/log folders unless intentionally resetting state.

## Troubleshooting quick checks

- `401 Unauthorized`: `UploadService:ApiKey` does not exactly match `LOG_FILES_INGEST_API_KEY` / `SYNCED_FILES_INGEST_API_KEY`.
- `503 Ingest API key not configured`: key is missing on the Next.js app process.
- Validation startup error: one or more watch directories do not exist or are inaccessible to the service account.

### Quick log checks (PowerShell)

Check the last 100 lines of the file log:

```powershell
Get-Content "C:\Program Files\WasteZero\WindowsUploadService\logs\service.log" -Tail 100
```

Check recent Windows Application log entries for the service source:

```powershell
Get-WinEvent -LogName Application -MaxEvents 100 | Where-Object { $_.ProviderName -eq "WasteZeroUpload" } | Select-Object TimeCreated, LevelDisplayName, Message
```

If `service.log` is missing, the service usually failed very early at startup (for example config validation), so check Event Viewer output first.

Single-command fallback (tries file log first, then Event Viewer):

```powershell
$log = "C:\Program Files\WasteZero\WindowsUploadService\logs\service.log"; if (Test-Path $log) { Get-Content $log -Tail 100 } else { Get-WinEvent -LogName Application -MaxEvents 100 | Where-Object { $_.ProviderName -eq "WasteZeroUpload" } | Select-Object TimeCreated, LevelDisplayName, Message }
```


## Local development run

From `windows-upload-service-dotnet/src/WasteZero.WindowsUploadService`:

```powershell
Copy-Item appsettings.Development.json.example appsettings.Development.json
```

Set values in `appsettings.Development.json`:

- `WatchDirectories`
- `ApiEndpoint` (usually `http://localhost:3000/api/log-files/ingest`)
- `ApiKey` (same value as `LOG_FILES_INGEST_API_KEY` in repo-root `.env.local`)

Then run:

```powershell
cd windows-upload-service-dotnet\src\WasteZero.WindowsUploadService
dotnet run
```

`dotnet run` uses `DOTNET_ENVIRONMENT=Development` from `Properties/launchSettings.json`, so `appsettings.Development.json` is merged automatically.
