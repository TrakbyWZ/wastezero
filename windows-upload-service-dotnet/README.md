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

## Configuration (.NET conventions)

Settings use the standard **`appsettings.json`** hierarchy, bound to the **`UploadService`** section and the `UploadServiceOptions` class (see [Configuration in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/) — the same host model applies to this worker).

| Setting (`UploadService:*`) | Description |
|-----------------------------|-------------|
| `WatchDirectories` | Array of absolute Windows paths to scan (non-recursive). |
| `ApiEndpoint` | Full URL to `/api/log-files/ingest`. |
| `ApiKey` | Must match `LOG_FILES_INGEST_API_KEY` (or `SYNCED_FILES_INGEST_API_KEY`) on the WasteZero app. **Do not commit real keys** — use user secrets locally and environment variables or a secured file on the server. |
| `VercelProtectionBypass` | Optional. Sent as `x-vercel-protection-bypass` for Vercel deployment protection. |
| `PollingIntervalSeconds` | Poll interval (minimum **5** after normalization). |
| `DatabasePath` | SQLite file (absolute or relative to the [content root](#content-root)). |
| `LogDir` | Folder for `service.log` (absolute or relative to content root). |
| `LogMaxSizeBytes` | Rotate `service.log` at this size (`0` = no rotation). |
| `LogMaxBackups` | Rotated files to keep. |
| `MaxStateRecords` | Trim SQLite to the N newest rows by `sent_at` (`0` = no limit). |
| `MaxStateAgeDays` | Drop rows older than N days (`0` = no limit). |

**Files (merged in the usual order):**

1. `appsettings.json` — safe defaults; committed to the repo.
2. `appsettings.{Environment}.json` — e.g. `appsettings.Development.json` for local URLs (still **no secrets** in git if your team prefers — use user secrets for keys).
3. Environment variables — override any key; use **double underscores** for nesting (see below).
4. [User secrets](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) — in **Development** only (`dotnet user-secrets`), ideal for `ApiKey` on a dev machine.

The host calls **`ValidateOnStart()`** for `UploadServiceOptions`: missing watch directories or API settings produce a clear error at startup.

### Environment variables (production-friendly)

Set on the machine or in the Windows Service recovery environment as needed. Use `UploadService__` + property name; use `__` for nested array indices per [Microsoft’s env var syntax](https://learn.microsoft.com/en-us/dotnet/core/extensions/configuration-providers#environment-variables).

| Variable | Example |
|----------|---------|
| `UploadService__ApiKey` | Shared ingest secret |
| `UploadService__ApiEndpoint` | `https://example.com/api/log-files/ingest` |
| `UploadService__WatchDirectories__0` | `C:\PrinterLogs` |
| `UploadService__WatchDirectories__1` | `D:\Logs\Printer` |
| `UploadService__DatabasePath` | `D:\Data\upload_state.db` |
| `UploadService__VercelProtectionBypass` | Vercel bypass secret |
| `UploadService__PollingIntervalSeconds` | `60` |
| `DOTNET_ENVIRONMENT` | `Production` (default when unset) — controls which optional `appsettings.{Environment}.json` is loaded. |

On Windows, `setx` and the Services UI can set these for the account that runs the service.

### Content root

Configuration files and relative paths (`DatabasePath`, `LogDir`) are resolved from the host **content root** (the folder containing the published executable and `appsettings*.json`), which defaults to **`AppContext.BaseDirectory`**. To override (rare):

`WasteZero.WindowsUploadService.exe --contentRoot="D:\Apps\UploadService"`

### Local developer: API key without committing secrets

From `windows-upload-service-dotnet\src\WasteZero.WindowsUploadService`:

```powershell
dotnet user-secrets set "UploadService:ApiKey" "your-local-dev-secret-matching-LOG_FILES_INGEST_API_KEY"
```

`appsettings.Development.json` in the project supplies sample **non-secret** values when `DOTNET_ENVIRONMENT` is `Development` (`dotnet run` sets this via `Properties/launchSettings.json`). Adjust paths and endpoint there for your machine; keep `ApiKey` out of source control and in user secrets.

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
2. Place **`appsettings.json`** (and optionally **`appsettings.Production.json`**) next to `WasteZero.WindowsUploadService.exe`, **or** configure the `UploadService` section entirely via environment variables (recommended for secrets).
3. Grant the **service account** (see below) **Modify** on that folder (for SQLite, logs, and settings files) and **Read** (and **List folder contents**) on each watch directory path.

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
- **Read** `appsettings*.json` in the install folder (if you use files instead of env-only configuration).

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

1. Run the executable **interactively** from an elevated or normal console (same folder as `appsettings.json`):

   ```powershell
   cd "C:\Program Files\WasteZero\WindowsUploadService"
   .\WasteZero.WindowsUploadService.exe
   ```

   Configuration errors are printed to stderr before the host starts.

2. Confirm **`UploadService:WatchDirectories`** paths exist and are directories (startup validation fails otherwise).

3. Confirm the service account has rights to the install folder, SQLite path, and log directory.

### Upload failures / retries

- Open **`logs\service.log`** under `logDir` (default `logs` next to the exe).
- Open **Event Viewer** → **Windows Logs** → **Application** and filter by source **WasteZeroUpload** (after the first successful registration of the event source; creating a new source may require running elevated once).

Common cases:

- **401** to `*.vercel.app` with HTML mentioning authentication: set `vercelProtectionBypass` (same as the Node README).
- **401 Unauthorized** JSON from the app: wrong `UploadService:ApiKey` vs `LOG_FILES_INGEST_API_KEY`.
- **503** “Ingest API key not configured”: fix server env on the WasteZero host.
- **Configuration / OptionsValidationException** at startup: fix `UploadService` in appsettings or environment variables (see [Configuration](#configuration-net-conventions)).

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
# .env.local (same value as UploadService:ApiKey — user secrets or env on the worker)
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
2. In `windows-upload-service-dotnet\src\WasteZero.WindowsUploadService`, adjust **`appsettings.Development.json`** for your machine (watch folder, `ApiEndpoint`). Set the API key with **user secrets** (do not put the real key in JSON that you commit):

   ```powershell
   cd windows-upload-service-dotnet\src\WasteZero.WindowsUploadService
   dotnet user-secrets set "UploadService:ApiKey" "same-as-LOG_FILES_INGEST_API_KEY"
   ```

   `Properties/launchSettings.json` sets `DOTNET_ENVIRONMENT=Development` so `appsettings.Development.json` is merged over `appsettings.json`.

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
| **401 Unauthorized** | `UploadService:ApiKey` does not exactly match `LOG_FILES_INGEST_API_KEY` on the Next.js process. |
| **Connection refused** | Next.js not running, or wrong host/port in `UploadService:ApiEndpoint`. |
| **Validation / 400** from ingest | File content may not match the parser’s expected log format; try a minimal `.txt` or use an existing sample from your team. |
| Watch folder errors at startup | Every path in `UploadService:WatchDirectories` must exist and be a directory before the worker starts. |

`UploadService:VercelProtectionBypass` is **not** needed for plain `http://localhost:3000` (it is only for protected Vercel deployments).

---

## Development run (not as a service)

Same as the local testing flow: **`appsettings.json`** + **`appsettings.Development.json`** + user secrets for `ApiKey`, then:

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
    ├── appsettings.json
    ├── appsettings.Development.json
    ├── Properties/launchSettings.json
    ├── Configuration/
    ├── Logging/
    └── Services/
```

---

## Migrating from the Node `windows-upload-service`

There is **no automatic import** of `sent_files.json` into SQLite. If you switch:

1. Deploy the .NET service with a **new** `UploadService:DatabasePath` (or default `upload_state.db`).
2. Either accept one-time re-upload attempts (duplicates become `SKIP` when the API reports a unique filename conflict), or pre-seed SQLite from your old JSON using a one-off script of your choice.

Configuration is no longer a single `config.json` file: map the same values into the **`UploadService`** section of `appsettings.json` / `appsettings.Production.json` or into `UploadService__*` environment variables.

The ingest contract is unchanged: `POST` with JSON `{ "content": "...", "filename": "optional.txt" }` and header `X-API-Key`.
