# WasteZero Windows File Upload Service

Standalone Node.js service that runs on a Windows Server, watches local directories for log files (`*.txt` or `*.csv`), and uploads them to the WasteZero app via the ingest API.

## Requirements

- **Node.js 18+** (for built-in `fetch`). Install from [nodejs.org](https://nodejs.org/) or via Chocolatey: `choco install nodejs-lts`.
- **Windows Server** (or any Windows machine) where log directories are accessible.

## 1. Configuration

### Option A: `config.json`

Copy `config.example.json` to `config.json` and set:

| Field | Description |
|-------|-------------|
| `watchDirectories` | Array of absolute Windows paths to monitor (e.g. `["C:\\PrinterLogs", "D:\\Logs\\Printer"]`). |
| `apiEndpoint` | Full URL of the ingest API (e.g. `https://your-app.example.com/api/log-files/ingest`, or `http://localhost:3000/api/log-files/ingest` for local dev). |
| `apiKey` | Secret token. Must match `LOG_FILES_INGEST_API_KEY` on the server (or `SYNCED_FILES_INGEST_API_KEY` for backward compatibility). |
| `vercelProtectionBypass` | *(Optional)* Secret for [Vercel Protection Bypass for Automation](https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation). Required when `apiEndpoint` is a Vercel deployment that has Deployment Protection (e.g. Vercel Authentication or password protection) enabled; the service sends it as the `x-vercel-protection-bypass` header so requests are allowed. |
| `pollingIntervalSeconds` | How often to scan for new files (default `60`; minimum 5). |
| `stateFile` | Path to the JSON manifest of sent files (default `sent_files.json`). Failed uploads are retried after 60 seconds. Files that already exist on the server (duplicate filename) are recorded as SKIP and not retried. |
| `logDir` | Directory for `logs/service.log` (default `logs`). |
| `logMaxSizeBytes` | Rotate `service.log` when it exceeds this size in bytes (default `5242880` = 5 MB). Set to `0` to disable rotation. |
| `logMaxBackups` | Keep this many rotated log files (e.g. `service.log.1`, `.2`, …). Default `3`. |
| `maxStateRecords` | Trim state file to this many most recent records per poll (default `0` = no limit). Dropped paths may be retried if seen again. |
| `maxStateAgeDays` | Trim state file to records from the last N days (default `0` = no limit). Dropped paths may be retried if seen again. |

### Option B: Environment variables

You can override with a `.env` file (or system env):

- `WATCH_DIRECTORIES` – JSON array of paths, e.g. `["C:\\PrinterLogs"]`
- `API_ENDPOINT` – Ingest URL
- `API_KEY` – Ingest API key
- `POLLING_INTERVAL` – Seconds (number)
- `STATE_FILE` – Path to state file
- `LOG_DIR` – Log directory
- `LOG_MAX_SIZE_BYTES` – Max log file size before rotation (bytes)
- `LOG_MAX_BACKUPS` – Number of rotated log files to keep
- `MAX_STATE_RECORDS` – Max records to keep in state file (0 = no limit)
- `MAX_STATE_AGE_DAYS` – Max age of state records in days (0 = no limit)
- `VERCEL_PROTECTION_BYPASS` or `VERCEL_AUTOMATION_BYPASS_SECRET` – Vercel Protection Bypass secret (see below)

### Using Vercel deployment protection

If your app is deployed on Vercel with **Deployment Protection** enabled (Vercel Authentication, password protection, or trusted IPs), requests from this service will get **401 Authentication Required** unless you use Vercel’s **Protection Bypass for Automation**.

1. **Get the bypass secret**
   - Open your project on [Vercel](https://vercel.com) → **Settings** → **Security** → **Deployment Protection**.
   - Under **Protection Bypass for Automation**, create or copy a bypass secret (you can have multiple per project).

2. **Configure the upload service**
   - In `config.json`, set `vercelProtectionBypass` to that secret, **or**
   - In `.env`, set `VERCEL_PROTECTION_BYPASS` (or `VERCEL_AUTOMATION_BYPASS_SECRET`) to the secret.

3. **Use your Vercel URL**
   - Set `apiEndpoint` to your deployment URL, e.g. `https://your-project.vercel.app/api/log-files/ingest` (preview or production). The service will send the bypass secret in the `x-vercel-protection-bypass` header so Vercel allows the request through; your app’s own auth (X-API-Key) is still validated by the ingest route.

Details: [Vercel – Protection Bypass for Automation](https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

### Server setup (primary app)

The primary app must expose an ingest endpoint that:

1. Accepts **API key** via header `X-API-Key` (or `Authorization: Bearer <key>`).
2. Accepts **POST** with JSON body: `{ "content": "<file text>", "filename": "optional.txt" }`.
3. Returns **200** or **201** on success.

For the WasteZero Next.js app, use the route:

- **URL:** `https://<your-domain>/api/log-files/ingest`
- Set **`LOG_FILES_INGEST_API_KEY`** in the server environment to the same value as `apiKey` in this service (the server also accepts `SYNCED_FILES_INGEST_API_KEY` for backward compatibility).

## 2. Run locally (no service)

```bash
cd windows-upload-service
npm install
npm start
```

- On startup, the script checks that every path in `watchDirectories` exists and is a directory.
- It polls each directory for `*.txt` and `*.csv` files, uploads new ones (not in the state file), and marks them sent on success.
- Logs go to `logs/service.log`. Failed uploads are retried on the next cycle.

## 3. Install as a Windows Service ([node-windows](https://www.npmjs.com/package/node-windows))

So the watcher starts automatically on boot and runs in the background, this project uses **node-windows** (WinSW under the hood). Installing or removing a service requires an **Administrator** shell.

### 3.1 Install

From an **elevated** Command Prompt or PowerShell, in the `windows-upload-service` folder (after `npm install`):

```bash
npm run install-service
```

This registers the service, writes wrapper files under a **`daemon/`** folder next to `index.js`, and starts the service. Logs from the WinSW wrapper also go under **`logs/`** (alongside `service.log` from the app).

Custom display name (still the same `index.js` and working directory):

```bash
node scripts/install-service.js install MyPrinterUpload
```

### 3.2 Manage the service

Use **Windows Services** (`services.msc`) or the command line:

| Action | Command (default name) |
|--------|-------------------------|
| Start | `net start wastezeroupload.exe` |
| Stop | `net stop wastezeroupload.exe` |

The internal service id matches the WinSW wrapper name in the `daemon` folder (for display name **WasteZeroUpload**, that is **`wastezeroupload.exe`**). `net start` / `net stop` use that id string, which can differ from the friendly name shown at the top of the service Properties dialog.

### 3.3 Uninstall

From an **elevated** prompt in `windows-upload-service`:

```bash
npm run uninstall-service
```

With a custom name:

```bash
node scripts/install-service.js uninstall MyPrinterUpload
```

### 3.4 Migrating from NSSM

If you previously installed with **NSSM** under a name like `WasteZeroUpload`, remove that service first (`nssm remove WasteZeroUpload confirm` or Services UI) so it does not conflict with the node-windows service.

### 3.5 Remove the install folder

To remove all traces of the upload service:

- Run **`npm run uninstall-service`** (or the matching `uninstall` command if you used a custom name).
- Delete the **`windows-upload-service`** folder (or your install path). This removes `config.json`, `.env`, `sent_files.json`, `daemon/`, and `logs/`. Back up `sent_files.json` first if you need to preserve upload history.

## 4. Test the ingest endpoint

**Option A – TypeScript script (recommended)**  
Upload a file (or a built-in test payload) using `config.json`:

```bash
npm run upload              # upload built-in test payload
npm run upload path/to/file.txt   # upload a specific file
```

Or with npx: `npx tsx test/upload-file.ts [file-path]`

**Option B – PowerShell**  
From the `windows-upload-service` folder:

```powershell
.\scripts\test-ingest.ps1
```

Both print the response status and body (or the error response on failure).

## 5. Logging and resilience

- **Logs:** All service events (start, successful uploads, connection errors) are written to **`logs/service.log`**. When running as a Windows service, WinSW may also write **`logs/*.out.log`** / **`*.err.log`** (or similar) under the configured `logpath`.
- **Resilience:** If the network is down or the API returns an error, the script logs the error and continues; failed files are recorded as FAIL and not retried. The process does not exit on connection errors.
- **State:** Every attempted upload (success or fail) is recorded in **`sent_files.json`** (or the path in `stateFile`) so the same file is not uploaded again. The file is a JSON array of rows: `path`, `filename`, `sentAt`, `status` (`"SUCCESS"` or `"FAIL"`), and optionally `errorMessage` for failures. Failed attempts are not retried. Suitable for loading as a dataframe or table.

### 5.1 Managing log and state file size

- **Log rotation:** When `service.log` reaches `logMaxSizeBytes` (default 5 MB), it is rotated: the current file is renamed to `service.log.1`, previous `service.log.1` to `service.log.2`, and so on, keeping up to `logMaxBackups` files (default 3). Set `logMaxSizeBytes` to `0` to disable rotation.
- **State trimming:** Each poll cycle can trim the state file so it does not grow forever. Set `maxStateRecords` (e.g. `10000`) to keep only the N most recent attempts, and/or `maxStateAgeDays` (e.g. `90`) to drop records older than N days. Trimmed paths are no longer considered "already sent," so the same file path could be retried if it appears again in the watch directory (e.g. a new file with the same name).
- **File lock retries:** If the log file or state file is locked by another process (e.g. antivirus or backup), the service retries the operation at periodic intervals (default: up to 5 retries, 400 ms apart) instead of failing immediately.

## 6. File layout

```
windows-upload-service/
├── config.example.json   # Copy to config.json
├── .env.example          # Optional overrides → .env
├── index.js              # Entry point
├── load-config.js        # Config + env loading
├── logger.js             # File logging to logDir
├── retry.js              # Retry on file lock (EBUSY / EACCES / EPERM)
├── state.js              # sent_files state
├── scripts/
│   ├── install-service.js  # node-windows install / uninstall helper
│   └── test-ingest.ps1     # Test ingest endpoint (PowerShell; uses config.json)
├── test/
│   ├── upload-api.test.js  # Unit tests (mock server)
│   └── upload-file.ts      # Upload a file via ingest API on demand (uses config.json)
├── logs/
│   └── service.log       # Created at runtime
├── sent_files.json       # Created at runtime (state)
└── README.md
```
