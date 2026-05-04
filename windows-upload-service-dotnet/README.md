# WasteZero Windows Upload Service (.NET)

Native **.NET 6** Windows Worker that polls configured folders for `*.txt` and `*.csv` files, uploads them to the WasteZero ingest API (`POST /api/log-files/ingest`), and records outcomes in a **SQLite** database. It is intended to run as a **Windows Service** so you can start, stop, restart, and monitor it with standard Windows tools (Services, Event Viewer, SC, Performance counters for the process, and so on).

This folder mirrors the behavior of the Node-based `windows-upload-service` in this repository, with these differences:

- **Runtime:** .NET 6 (`net6.0-windows`) — no Node.js installation on the server.
- **State:** SQLite file (`databasePath`) instead of `sent_files.json` — easy to back up, query, and inspect.
- **Hosting:** `Microsoft.Extensions.Hosting.WindowsServices` — a first-class Windows Service host, not Node + WinSW.

If you install a newer [.NET SDK](https://dotnet.microsoft.com/download) (for example 8.x), you can retarget the project to `net8.0-windows` in the `.csproj` without changing the rest of the design.

---

## Requirements

- **Windows** (client or Server) where the log directories exist.
- Either:
  - **[.NET 6 Desktop Runtime](https://dotnet.microsoft.com/en-us/download/dotnet/6.0)** on the server (for *framework-dependent* publish), or
  - No runtime if you publish **self-contained** (larger binaries, simpler deployment).

---

## Build

From a developer machine (with the .NET SDK):

```powershell
cd windows-upload-service-dotnet
dotnet restore
dotnet build -c Release
```

**Publish** for deployment (framework-dependent, smaller):

```powershell
dotnet publish .\src\WasteZero.WindowsUploadService\WasteZero.WindowsUploadService.csproj `
  -c Release -r win-x64 --self-contained false -o .\publish\fd
```

**Publish self-contained** (no runtime install on the server):

```powershell
dotnet publish .\src\WasteZero.WindowsUploadService\WasteZero.WindowsUploadService.csproj `
  -c Release -r win-x64 --self-contained true -o .\publish\sc
```

Copy the output folder (for example `publish\sc`) to the server, for example:

`C:\Program Files\WasteZero\WindowsUploadService\`

---

## Configuration

1. Copy `config.example.json` from the project (or from your build output) to **`config.json`** in the **same folder as** `WasteZero.WindowsUploadService.exe`.
2. Edit values to match your environment.

| JSON property | Description |
|---------------|-------------|
| `watchDirectories` | Absolute Windows paths to scan (non-recursive). |
| `apiEndpoint` | Full URL to `/api/log-files/ingest`. |
| `apiKey` | Must match `LOG_FILES_INGEST_API_KEY` (or `SYNCED_FILES_INGEST_API_KEY`) on the WasteZero app. |
| `vercelProtectionBypass` | Optional. Sent as `x-vercel-protection-bypass` when using Vercel deployment protection. |
| `pollingIntervalSeconds` | Poll interval (minimum **5**). |
| `databasePath` | SQLite database file (absolute or relative to the **install directory** / content root). |
| `logDir` | Folder for `service.log` (absolute or relative to install directory). |
| `logMaxSizeBytes` | Rotate `service.log` when it exceeds this size (`0` = no rotation). |
| `logMaxBackups` | Number of rotated files to keep. |
| `maxStateRecords` | Trim SQLite to the N newest rows by `sent_at` (`0` = no limit). Trimmed paths can be uploaded again if the file reappears. |
| `maxStateAgeDays` | Drop rows older than N days (`0` = no limit). |

### Environment variables (optional overrides)

Same semantics as the Node service where applicable:

| Variable | Purpose |
|----------|---------|
| `WATCH_DIRECTORIES` | JSON array or comma-separated paths. |
| `API_ENDPOINT` | Ingest URL. |
| `API_KEY` | Ingest API key. |
| `VERCEL_PROTECTION_BYPASS` / `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel bypass secret. |
| `POLLING_INTERVAL` | Seconds. |
| `DATABASE_PATH` / `STATE_DATABASE` | SQLite file path. |
| `LOG_DIR`, `LOG_MAX_SIZE_BYTES`, `LOG_MAX_BACKUPS` | Logging. |
| `MAX_STATE_RECORDS`, `MAX_STATE_AGE_DAYS` | SQLite trimming. |

You can set these via machine environment variables (`setx /M`, GPO, Intune, etc.). Most deployments rely on `config.json` next to the executable and do not need per-service env vars.

### Content root

The service resolves `config.json`, relative `databasePath`, and relative `logDir` from **`AppContext.BaseDirectory`** (the folder containing the main assembly / published files). To override (rare), pass:

`WasteZero.WindowsUploadService.exe --contentRoot="D:\Apps\UploadService"`

---

## SQLite schema and operations

Table: **`file_upload_state`**

| Column | Meaning |
|--------|---------|
| `file_path` | Normalized full path (primary key). |
| `filename` | Base file name. |
| `sent_at` | ISO 8601 timestamp of last attempt. |
| `status` | `SUCCESS`, `FAIL`, or `SKIP`. |
| `error_message` | Short reason for failures / skips. |
| `retry_after` | ISO time after which a `FAIL` row is eligible for retry. |

**Example queries** (use [DB Browser for SQLite](https://sqlitebrowser.org/) or `sqlite3`):

```sql
SELECT * FROM file_upload_state ORDER BY sent_at DESC LIMIT 50;
SELECT * FROM file_upload_state WHERE status = 'FAIL' ORDER BY sent_at DESC;
```

**Backup:** stop the service (optional but safest for a consistent copy), copy the `.db` file, then start the service again.

---

## Install as a Windows Service

Installation requires an **elevated** PowerShell or Command Prompt.

### Option A — PowerShell script (recommended)

1. Publish to a permanent path on the server, for example `C:\Program Files\WasteZero\WindowsUploadService\`.
2. Place `config.json` next to `WasteZero.WindowsUploadService.exe`.
3. Grant the **service account** (see below) **Modify** on that folder (for SQLite, logs, and config) and **Read** (and **List folder contents**) on each `watchDirectories` path.

```powershell
cd C:\path\to\repo\windows-upload-service-dotnet\scripts
.\Install-Service.ps1 -InstallPath "C:\Program Files\WasteZero\WindowsUploadService"
```

Optional parameters: `-ServiceName`, `-DisplayName`, `-ServiceAccount`.

### Option B — `New-Service` manually

```powershell
$exe = "C:\Program Files\WasteZero\WindowsUploadService\WasteZero.WindowsUploadService.exe"
New-Service -Name "WasteZeroUpload" -BinaryPathName "`"$exe`"" `
  -DisplayName "WasteZero Windows Upload" -StartupType Automatic
Start-Service -Name "WasteZeroUpload"
```

### Option C — `sc.exe`

Mind the **space after `=`** in `binPath=` and `DisplayName=`:

```cmd
sc.exe create WasteZeroUpload binPath= "C:\Program Files\WasteZero\WindowsUploadService\WasteZero.WindowsUploadService.exe" start= auto DisplayName= "WasteZero Windows Upload"
sc.exe start WasteZeroUpload
```

---

## Service account and permissions

| Account | When to use |
|---------|-------------|
| **LocalSystem** | Easiest for a dedicated machine; has broad rights — avoid if the server hosts many roles. |
| **NT AUTHORITY\LOCAL SERVICE** | Least privilege for local-only work; grant explicit ACLs on install folder and watch paths. |
| **NT AUTHORITY\NETWORK SERVICE** | If you need outbound network identity as the machine account in some setups. |
| **NT SERVICE\YourServiceName** | Virtual service account tied to this service; grant ACLs like Local Service. |
| **Domain user / gMSA** | Enterprise standard; grant least privilege on folders and shares. |

The service account must be able to:

- **Read** files in every `watchDirectories` entry.
- **Read/Write/Create** the SQLite file (`databasePath`) and its directory.
- **Write** under `logDir` (for `service.log`).
- **Read** `config.json` in the install folder.

For **HTTPS** to public endpoints, ensure TLS 1.2+ and normal outbound HTTPS (proxy if required) are allowed for that account.

---

## Restart and day-to-day management

| Action | Command |
|--------|---------|
| Start | `Start-Service WasteZeroUpload` or `sc.exe start WasteZeroUpload` |
| Stop | `Stop-Service WasteZeroUpload` or `sc.exe stop WasteZeroUpload` |
| Restart | `Restart-Service WasteZeroUpload` |
| Status | `Get-Service WasteZeroUpload` |

You can also use **services.msc** → **WasteZero Windows Upload** (or your display name).

---

## Uninstall

Elevated PowerShell:

```powershell
cd C:\path\to\repo\windows-upload-service-dotnet\scripts
.\Uninstall-Service.ps1
```

Or:

```cmd
sc.exe stop WasteZeroUpload
sc.exe delete WasteZeroUpload
```

Then remove the install folder if you no longer need logs or the SQLite database.

---

## Troubleshooting

### Service stops immediately or will not start

1. Run the executable **interactively** from an elevated or normal console (same folder as `config.json`):

   ```powershell
   cd "C:\Program Files\WasteZero\WindowsUploadService"
   .\WasteZero.WindowsUploadService.exe
   ```

   Configuration errors are printed to stderr before the host starts.

2. Confirm **`watchDirectories`** paths exist and are directories (startup validation fails otherwise).

3. Confirm the service account has rights to the install folder, SQLite path, and log directory.

### Upload failures / retries

- Open **`logs\service.log`** under `logDir` (default `logs` next to the exe).
- Open **Event Viewer** → **Windows Logs** → **Application** and filter by source **WasteZeroUpload** (after the first successful registration of the event source; creating a new source may require running elevated once).

Common cases:

- **401** to `*.vercel.app` with HTML mentioning authentication: set `vercelProtectionBypass` (same as the Node README).
- **401 Unauthorized** JSON from the app: wrong `apiKey` vs `LOG_FILES_INGEST_API_KEY`.
- **503** “Ingest API key not configured”: fix server env on the WasteZero host.

### SQLite “database is locked”

The service sets a busy timeout and serializes writes. If antivirus or backup holds the file exclusively, pause scanning of that folder or move the database to a path excluded from aggressive locking.

### HTTP proxy

If outbound traffic must use a proxy, configure system proxy or run under an account whose WinHTTP proxy is set; for advanced scenarios, extend `HttpClient` handler in code.

---

## Testing with local Next.js and Supabase (developers)

The upload service talks **only to your Next.js app** over HTTP. It does **not** connect to Supabase. When you run the WasteZero app locally, Next.js uses your `.env.local` Supabase settings and writes ingested files into Postgres (for example the **`log_files`** table). Use the steps below to exercise the full path on your machine.

### 1. Run local Supabase and the Next.js app

Follow the repo guide **[Local development](../content/docs/local-development.md)** (clone, `pnpm install`, Docker, `pnpm exec supabase start`, merge `pnpm exec supabase status -o env` into `.env.local`, `pnpm exec supabase db reset` when you need a clean schema).

### 2. Set the ingest API key for local dev

In the **repository root** `.env.local`, set a shared secret the upload service will send as `X-API-Key`:

```bash
# .env.local (same value you will put in config.json apiKey)
LOG_FILES_INGEST_API_KEY=your-local-dev-secret
```

You can use any long random string (for example `openssl rand -base64 32`). The ingest route also accepts **`SYNCED_FILES_INGEST_API_KEY`** if your team still uses that name—use one or the other consistently with `apiKey` in the upload service.

Restart **`pnpm dev`** after changing `.env.local` so the server picks up the variable.

### 3. Start Next.js

From the repo root:

```bash
pnpm dev
```

The app should be available at **`http://localhost:3000`**. The ingest URL for the upload service is:

`http://localhost:3000/api/log-files/ingest`

### 4. Configure and run the .NET upload service

1. Pick a folder on disk for test logs (for example `C:\Temp\WasteZeroUploadTest`). Create a small **`sample.txt`** or **`sample.csv`** there so the worker has something to upload.
2. In `windows-upload-service-dotnet\src\WasteZero.WindowsUploadService`, copy `config.example.json` to **`config.json`** and set at least:

| Field | Example for local dev |
|-------|------------------------|
| `watchDirectories` | `["C:\\Temp\\WasteZeroUploadTest"]` (JSON string; escape backslashes in the file) |
| `apiEndpoint` | `http://localhost:3000/api/log-files/ingest` |
| `apiKey` | Same string as `LOG_FILES_INGEST_API_KEY` |
| `pollingIntervalSeconds` | `10` (optional, faster feedback while testing) |
| `databasePath` | `upload_state.db` (default is fine; stays next to the exe) |

3. Run the worker **interactively** (no Windows Service required for local testing):

```powershell
cd windows-upload-service-dotnet\src\WasteZero.WindowsUploadService
dotnet run
```

After the next poll cycle, check:

- **Next.js terminal** — request logs or errors from `/api/log-files/ingest`.
- **`logs\service.log`** (next to the project output or under `bin\...\net6.0-windows\logs` depending on how you run) — upload success or HTTP errors.
- **SQLite** `upload_state.db` — row with `status` = `SUCCESS` for your file path.
- **Supabase Studio** — URL is printed by `pnpm exec supabase status` (see [Local development](../content/docs/local-development.md#local-studio)); open **Table Editor** → **`log_files`** to see a new row for the uploaded filename.
- **In-app** — after signing in, open the log / sync area in the app (if your build exposes it) to confirm the file appears in the UI.

### 5. Common local issues

| Symptom | What to check |
|--------|----------------|
| **503** “Ingest API key not configured” | `LOG_FILES_INGEST_API_KEY` missing from `.env.local` or dev server not restarted. |
| **401 Unauthorized** | `apiKey` in `config.json` does not exactly match the env var on the Next.js process. |
| **Connection refused** | Next.js not running, or wrong host/port in `apiEndpoint`. |
| **Validation / 400** from ingest | File content may not match the parser’s expected log format; try a minimal `.txt` or use an existing sample from your team. |
| Watch folder errors at startup | Paths in `watchDirectories` must exist and be directories before the worker starts. |

`vercelProtectionBypass` is **not** needed for plain `http://localhost:3000` (it is only for protected Vercel deployments).

---

## Development run (not as a service)

Same as step 4 above: use **`config.json`** next to the project, then:

```powershell
cd windows-upload-service-dotnet\src\WasteZero.WindowsUploadService
dotnet run
```

Press Ctrl+C to stop.

---

## Project layout

```
windows-upload-service-dotnet/
├── README.md
├── WasteZero.WindowsUploadService.sln
├── scripts/
│   ├── Install-Service.ps1
│   └── Uninstall-Service.ps1
└── src/WasteZero.WindowsUploadService/
    ├── Program.cs
    ├── appsettings.json          # optional; primary config is config.json
    ├── config.example.json
    ├── Configuration/
    ├── Logging/
    └── Services/
```

---

## Migrating from the Node `windows-upload-service`

There is **no automatic import** of `sent_files.json` into SQLite. If you switch:

1. Deploy the .NET service with a **new** `databasePath`.
2. Either accept one-time re-upload attempts (duplicates become `SKIP` when the API reports a unique filename conflict), or pre-seed SQLite from your old JSON using a one-off script of your choice.

The ingest contract is unchanged: `POST` with JSON `{ "content": "...", "filename": "optional.txt" }` and header `X-API-Key`.
