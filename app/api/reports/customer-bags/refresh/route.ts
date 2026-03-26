import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /api/reports/customer-bags/refresh
 * Truncates and repopulates report_customer_bags from log_entries.
 * Use when the table was not populated during ingest or to force a full rebuild.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("refresh_customer_bags_report_full");

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to refresh report" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, message: "Report refreshed." });
}
