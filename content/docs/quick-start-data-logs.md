# Quick Start: Review Data Logs and Validate

Use Data Logs as the final validation step for each end-to-end process run.
The printer-side Windows service automatically uploads processing data back to WasteZero after CSV files are consumed.

---

## Process

1. Open **Data Logs**.
2. Find the synced file tied to your print run.
3. Open the file entry to review details.
4. Confirm expected totals and investigate anomalies.

---

## Screenshots

Data Logs list page:

![Data Logs page list view](/docs-images/data-logs-page.png)

Data file detail preview:

![Data Logs file detail preview](/docs-images/data-logs-preview.png)

---

## What this page shows

- **Uploaded file list**: Files received from printer sync.
- **File detail view**: Parsed records for selected file.
- **Read counts**: Processing totals and statistics.
- **Duplicate indicators**: Repeated reads or duplicated entries.
- **Ingest timing/context**: Audit and troubleshooting context.

---

## Validation checklist

- Expected file appears in Data Logs.
- Counts match print expectations.
- Duplicate alerts are reviewed and resolved.
- No unexpected errors remain.

> **Note:** If no file appears after a run, check printer system status and Windows service health.

---

## Next step

Go to [Sign Out and Other Options](./quick-start-sign-out.md).
