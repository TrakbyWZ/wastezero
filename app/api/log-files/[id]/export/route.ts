import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const SELECT_COLUMNS =
  "child_code,effective_child_code,effective_parent_code,child_code_timestamp,parent_code_timestamp,parent_code,job_name,job_number,child_operator,child_filename,child_sort_order";

const CASPIO_HEADER = [
  "Camera1",
  "C1EV",
  "ParentEV",
  "Date",
  "Time",
  "ParentTime",
  "Camera2",
  "Job Name",
  "Job Number",
  "Operator",
];

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const MONTHS_1_12 = (d: Date) => d.getUTCMonth() + 1;

/** M/D/YYYY, UTC clock value - matches the legacy Caspio report's un-converted display. */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${MONTHS_1_12(d)}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** h:mm:ss AM/PM, UTC clock value. */
function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hours24 = d.getUTCHours();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hours12}:${mm}:${ss} ${period}`;
}

/** M/D/YYYY H:mm, 24-hour, no seconds, UTC clock value. */
function formatParentTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS_1_12(d)}/${d.getUTCDate()}/${d.getUTCFullYear()} ${d.getUTCHours()}:${mm}`;
}

type Row = {
  child_code: string | null;
  effective_child_code: string | null;
  effective_parent_code: string | null;
  child_code_timestamp: string | null;
  parent_code_timestamp: string | null;
  parent_code: string | null;
  job_name: string | null;
  job_number: string | null;
  child_operator: string | null;
  child_filename: string;
  child_sort_order: number | null;
};

function toCsvLine(row: Row): string {
  return [
    csvField(row.child_code),
    csvField(row.effective_child_code),
    csvField(row.effective_parent_code),
    csvField(formatDate(row.child_code_timestamp)),
    csvField(formatTime(row.child_code_timestamp)),
    csvField(formatParentTime(row.parent_code_timestamp)),
    csvField(row.parent_code),
    csvField(row.job_name),
    csvField(row.job_number),
    csvField(row.child_operator),
  ].join(",");
}

const FETCH_BATCH_SIZE = 5000;

/**
 * GET /api/log-files/[id]/export — Customer-facing CSV for one child log
 * file, matching the legacy "Caspio Download" report's exact column names,
 * order, and date/time formatting (UTC clock values, not converted to any
 * timezone) so customers see a familiar, unchanged report shape.
 *
 * Shows each row's *effective* (corrected) codes, not the raw scan - the
 * customer should see the final, gap-filled result, never the fact that a
 * Bad_Read was manually or automatically corrected. Excluded rows
 * (usr_exclude_row) are dropped entirely for the same reason: a QC exclusion
 * is an internal editorial decision, not something to expose downstream.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: childLogFileId } = await params;
  if (!childLogFileId) {
    return NextResponse.json({ error: "File ID required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // PostgREST caps rows per request (the role's db.max_rows) regardless of
  // the requested .range() width, so the loop advances and stops based on
  // what actually came back, not FETCH_BATCH_SIZE.
  const rows: Row[] = [];
  for (let from = 0; ; ) {
    const { data: batch, error } = await admin
      .from("vw_api_log_correlations")
      .select(SELECT_COLUMNS)
      .eq("child_log_file_id", childLogFileId)
      .eq("usr_exclude_row", false)
      .order("child_sort_order", { ascending: true, nullsFirst: false })
      .order("effective_child_code", { ascending: true })
      .range(from, from + FETCH_BATCH_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const batchRows = (batch ?? []) as unknown as Row[];
    rows.push(...batchRows);
    if (batchRows.length === 0) break;
    from += batchRows.length;
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "File not found or has no correlation data" }, { status: 404 });
  }

  // run_log_correlation() doesn't link parent_log_entry_id (hence parent_code/
  // parent_code_timestamp stay null) when the CHILD read is Bad_Read - it only
  // sets usr_parent_code as a best-effort ceiling match. The legacy Caspio
  // report never left Camera2/ParentTime blank in this situation, so backfill
  // the real parent entry here by looking up its code in the resolved parent
  // file directly, rather than changing core correlation behavior.
  const needsParentBackfill = rows.filter((r) => r.parent_code === null && r.effective_parent_code !== null);
  if (needsParentBackfill.length > 0) {
    const { data: fileSummary } = await admin
      .from("vw_api_log_correlation_files")
      .select("last_correlate_resolved_parent_file_id")
      .eq("child_log_file_id", childLogFileId)
      .maybeSingle();
    const parentFileId = fileSummary?.last_correlate_resolved_parent_file_id as string | null | undefined;

    if (parentFileId) {
      const codes = [...new Set(needsParentBackfill.map((r) => r.effective_parent_code as string))];
      const { data: parentEntries } = await admin
        .from("log_entries")
        .select("data_value,data_timestamp")
        .eq("log_file_id", parentFileId)
        .in("data_value", codes);

      const timestampByCode = new Map<string, string>();
      for (const entry of (parentEntries ?? []) as { data_value: string; data_timestamp: string }[]) {
        if (!timestampByCode.has(entry.data_value)) {
          timestampByCode.set(entry.data_value, entry.data_timestamp);
        }
      }
      for (const row of needsParentBackfill) {
        const code = row.effective_parent_code as string;
        row.parent_code = code;
        row.parent_code_timestamp = timestampByCode.get(code) ?? null;
      }
    }
  }

  const csv = [CASPIO_HEADER.join(","), ...rows.map(toCsvLine)].join("\r\n") + "\r\n";
  const baseName = rows[0].child_filename.replace(/\.[^./\\]+$/, "");
  const safeFilename = `${baseName} Report`.replace(/[^a-zA-Z0-9 _.-]/g, "_");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename}.csv"`,
    },
  });
}
