import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Backs the Quality Control detail screen's run-history panel: every
 * log_correlation_runs row (both 'correlate' and 'gap_fill' operations) for
 * one child log file, most recent first, with every file-id column it
 * carries resolved to a filename (which camera1/camera2 files were
 * correlated). Replaces the raw-SQL query documented in
 * content/docs/log-correlation-operations.md with a UI view.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const childLogFileId = searchParams.get("child_log_file_id")?.trim() ?? "";
  if (!childLogFileId) {
    return NextResponse.json({ error: "child_log_file_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("vw_api_log_correlation_runs")
    .select("*")
    .eq("child_log_file_id_param", childLogFileId)
    .order("run_started_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: rows ?? [] });
}
