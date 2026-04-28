# Quick Start: Create Batches and Export CSV

After customer and sequence setup, create the batch and generate printer files.

---

## Create a new batch (step-by-step)

1. Open **Batches**.
2. Click **New Batch** (or the add/create batch action).
3. In the new batch form, select the correct **Customer**.
4. Select the correct **Customer Sequence** for that customer.
5. Complete required fields such as count, date, or job-specific values.
6. Review values before saving:
   - Customer matches the job request.
   - Sequence matches the intended label format/range.
   - Quantity/count values are correct.
7. Click **Save** to create the batch.
8. This should prompt you with a save dialog and a auto-generated csv file name in the format:
   `{CUSTOMER_NUMBER}_{YYYYMMDD}_{HHMMSS}.csv`
   
   Here is an example one:
   `EVERGREEN_20260428_122748.csv`

   The date/time in the filename is the **time at which the file was generated (UTC)**.

   > **Timezone note:** Batch filenames always use UTC, not local computer time.

   ![Batch Save Dialog](/docs-images/batch-save-dialog.png)

9. If you miss saving this file, you can always re-export it by using the "Download" button for that batch.
11. Save the downloaded CSV for printer-side automated processing to the appropriate printer/computer.
12. Then upload this file to the printing system so you can use it to run a print job for the labels.

---

## Screenshots

Batches list page:

![Batches page list view](/docs-images/batch-page.png)

Create new batch form:

![Create new batch form](/docs-images/batch-new-batch.png)

---

## Batch entry tips

- Confirm the customer first, then select sequence.
- If the sequence list looks wrong, go back and verify the selected customer.
- Do not generate files until the batch record is saved successfully.

---

## What the batch controls

- Tracks sequence usage for that run.
- Produces CSV output from the selected customer and sequence context.
- Produces CSV files consumed by the printer-side Windows service.

> **Important:** Selecting the wrong customer or sequence can create invalid or duplicate labels.

---

## Operator checklist

[] Customer is correct.
[] Batch saved successfully.
[] Sequence is correct by inspecting the first few lines of the file.
[] File name matches the customer number.
[] CSV files generated for automated printer processing.

---

## Next step

Go to [Review Data Logs and Validate](./quick-start-data-logs.md).
