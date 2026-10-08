import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const EXPORT_COLUMNS = [
  "id",
  "child_sort_order",
  "effective_child_code",
  "effective_parent_code",
  "child_code",
  "parent_code",
  "usr_child_code",
  "usr_parent_code",
  "child_code_timestamp",
  "parent_code_timestamp",
  "is_inferred",
  "usr_exclude_row",
  "notes",
  "overridden_by",
  "overridden_at",
  "created_by",
  "modified_by",
  "created_timestamp",
  "modified_timestamp",
  "child_filename",
  "parent_filename",
  "customer_num",
  "job_name",
  "job_number",
] as const;

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows: Record<string, unknown>[]): string {
  const header = EXPORT_COLUMNS.join(",");
  const lines = rows.map((row) => EXPORT_COLUMNS.map((col) => csvField(row[col])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

const FETCH_BATCH_SIZE = 5000;

/**
 * GET /api/log-correlation-runs/[id]/export — CSV of every log_correlations
 * row this run created or last modified (created_by/modified_by, both FKs to
 * log_correlation_runs), for developers tracing a specific run's output.
 * Fetched in batches since a correlate run can touch tens of thousands of rows.
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

  const { id: runId } = await params;
  if (!runId) {
    return NextResponse.json({ error: "Run ID required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: run, error: runError } = await admin
    .from("vw_api_log_correlation_runs")
    .select("id, operation, run_started_at, child_filename")
    .eq("id", runId)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: runError?.message ?? "Run not found" }, { status: 404 });
  }

  // PostgREST silently caps rows per request (the role's db.max_rows, often
  // 1000) regardless of the requested .range() width, so the loop must
  // advance and stop based on what actually came back, not FETCH_BATCH_SIZE.
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; ) {
    const { data: batch, error } = await admin
      .from("vw_api_log_correlations")
      .select(EXPORT_COLUMNS.join(","))
      .or(`created_by.eq.${runId},modified_by.eq.${runId}`)
      .order("child_sort_order", { ascending: true, nullsFirst: false })
      .order("effective_child_code", { ascending: true })
      .range(from, from + FETCH_BATCH_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const batchRows = (batch ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batchRows);
    if (batchRows.length === 0) break;
    from += batchRows.length;
  }

  const csv = toCsv(rows);
  const startedAt = new Date(run.run_started_at).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safeFilename = `${run.child_filename}-${run.operation}-${startedAt}`.replace(/[^a-zA-Z0-9_.-]/g, "_");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename}.csv"`,
    },
  });
}
