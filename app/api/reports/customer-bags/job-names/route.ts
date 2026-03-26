import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET ?q=... - distinct job names for autocomplete from the precomputed Customer Bags report table. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const admin = createAdminClient();

  let query = admin
    .from("report_customer_bags")
    .select("cam1_job_name")
    .not("cam1_job_name", "is", null)
    .limit(200)
    .order("cam1_job_name", { ascending: true });

  if (q) {
    query = query.ilike("cam1_job_name", `%${q}%`);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const names = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => (r as { cam1_job_name: string | null }).cam1_job_name)
        .filter((n): n is string => n != null && n.trim() !== "")
    )
  ).sort();

  return NextResponse.json({ job_names: names });
}
