# Power BI Reports

Trak ships a Power BI project (`TrakbyWz_Reports`) built on top of the same batch, customer, customer sequence, and log data you see in the app. It's meant for ad-hoc analysis and reporting that goes beyond what the in-app views provide — pivoting and charting batch volumes, customer activity, and log correlation results over time.

## What's in the report

The semantic model connects directly to the production Postgres database (via the Supabase pooler) and includes:

- Batches, customers, and customer sequences
- Log files and log entries
- Log correlation runs and results

The underlying connection details (`sql_endpoint`, `sql_dbname`) are parameterized in `powerbi/parameters.yml` so the same project can point at production or a local Supabase instance without editing the model by hand.

## Downloading the project

The button below downloads a zip of the current Power BI project files (the `.pbip` file plus the `.Report` and `.SemanticModel` folders). The archive is rebuilt automatically whenever the report changes, so you'll always get the latest version.

[Download Power BI Project](/api/powerbi/download)

## Opening the report

1. Unzip the download — you should see `TrakbyWz_Reports.pbip`, `TrakbyWz_Reports.Report/`, and `TrakbyWz_Reports.SemanticModel/` in the same folder.
2. Open `TrakbyWz_Reports.pbip` in Power BI Desktop.
3. The first time you open it, Power BI will prompt you for database credentials for the Postgres connection. **Get this password from your administrator** — it is not included in the project files.
4. Once connected, Power BI will load the data and you can explore or build on the existing report pages.

If you only need to view the report rather than edit it, ask your administrator whether a published copy is available in your organization's Power BI workspace instead.
