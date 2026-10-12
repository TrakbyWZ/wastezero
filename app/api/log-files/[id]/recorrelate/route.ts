import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Manually re-correlates one child log file (p_allow_reprocess := true),
 * for the Quality Control detail screen's "Re-correlate" button. Mirrors
 * the manual invocation documented in content/docs/log-correlation-operations.md,
 * attributed to the signed-in user instead of a raw SQL session.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const session = await getSession();
  const admin = createAdminClient();

  const { data: runId, error: rpcErr } = await admin.rpc("run_log_correlation", {
    p_child_log_file_id: id,
    p_allow_reprocess: true,
    p_triggered_by: `manual:${session?.email ?? "unknown"}`,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const { data: runRow, error: selectErr } = await admin
    .from("log_correlation_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (selectErr || !runRow) {
    return NextResponse.json({ error: selectErr?.message ?? "Run not found after RPC" }, { status: 500 });
  }

  return NextResponse.json(runRow);
}
