import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Request body for correcting a log_correlations row from Quality Control */
export type UpdateLogCorrelationBody = {
  usr_child_code?: string | null;
  usr_parent_code?: string | null;
  usr_exclude_row?: boolean;
  notes?: string | null;
};

function trimOrNull(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function PATCH(
  request: Request,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const hasChildCode = Object.prototype.hasOwnProperty.call(raw, "usr_child_code");
  const hasParentCode = Object.prototype.hasOwnProperty.call(raw, "usr_parent_code");
  const hasExcludeRow = Object.prototype.hasOwnProperty.call(raw, "usr_exclude_row");
  const hasNotes = Object.prototype.hasOwnProperty.call(raw, "notes");

  if (!hasChildCode && !hasParentCode && !hasExcludeRow && !hasNotes) {
    return NextResponse.json(
      { error: "At least one of usr_child_code, usr_parent_code, usr_exclude_row, notes is required." },
      { status: 400 },
    );
  }

  const session = await getSession();

  const updatePayload: Record<string, unknown> = {
    overridden_by: session?.email ?? "unknown",
    overridden_at: new Date().toISOString(),
    modified_timestamp: new Date().toISOString(),
  };
  if (hasChildCode) {
    updatePayload.usr_child_code = trimOrNull(raw.usr_child_code as string | null);
  }
  if (hasParentCode) {
    updatePayload.usr_parent_code = trimOrNull(raw.usr_parent_code as string | null);
  }
  if (hasExcludeRow) {
    updatePayload.usr_exclude_row = raw.usr_exclude_row === true;
  }
  if (hasNotes) {
    updatePayload.notes = trimOrNull(raw.notes as string | null);
  }

  const admin = createAdminClient();

  const { data: existingRow, error: existingErr } = await admin
    .from("log_correlations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existingErr || !existingRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: updateErr } = await admin
    .from("log_correlations")
    .update(updatePayload)
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { data: row, error: selectErr } = await admin
    .from("vw_api_log_correlations")
    .select("*")
    .eq("id", id)
    .single();

  if (selectErr || !row) {
    return NextResponse.json({ error: selectErr?.message ?? "Not found after update" }, { status: 500 });
  }

  return NextResponse.json(row);
}
