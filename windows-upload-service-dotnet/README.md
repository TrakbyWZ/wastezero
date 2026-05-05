# WasteZero Windows Upload Service (.NET)

.NET worker that watches folders for `*.txt` / `*.csv` files and POSTs them to WasteZero’s **`/api/log-files/ingest`** endpoint. User-facing setup, configuration, Windows Service install, logs, resilience, and troubleshooting are maintained in **one place**:

| Where you are | Documentation |
| ------------- | ---------------- |
| **This repo** | [`content/docs/windows-upload-service.md`](../content/docs/windows-upload-service.md) |
| **Signed into the app** | **Help → Documentation** → section **Windows Upload Service** → _Setup and Operations (.NET)_ (`/protected/docs/windows-upload-service`) |

## Quick orientation (this folder)

- **Project:** `src/WasteZero.WindowsUploadService/`
- **Solution:** `WasteZero.WindowsUploadService.sln`
- **Service install scripts:** `scripts/Install-Service.ps1`, `scripts/Uninstall-Service.ps1`

Change **code** here; change **product docs** only under `content/docs/windows-upload-service.md`.
