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
- **File detail view**: Parsed records for selected file (raw structured rows as stored in the database).
- **Read counts**: Totals such as total reads, bad reads, and sequence reads from the file footer.
- **Export**: Download original text or a cleansed CSV of parsed columns (see Preview table columns).
- **Ingest timing/context**: Who uploaded the file and when (audit and troubleshooting).

> **Timezone note:** System-generated timestamps are stored and displayed using UTC unless otherwise labeled.

---

## Validation checklist

- Expected file appears in Data Logs.
- Counts match print expectations (including bad reads and sequence reads where relevant).
- Spot-check parsed rows in Preview or export if something looks off.
- No unexpected errors remain.

> **Note:** If no file appears after a run, check printer system status and Windows service health.

---

## Next step

Go to [Sign Out and Other Options](./quick-start-sign-out.md).
