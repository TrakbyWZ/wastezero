import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CustomerSequenceRow } from "@/lib/types";
import { NextResponse } from "next/server";

function matchesSearch(row: CustomerSequenceRow, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  const cust = row.customer;
  const nameMatch =
    cust?.customer_description?.toLowerCase().includes(lower) ||
    cust?.customer_num?.toLowerCase().includes(lower) ||
    false;
  const prefixMatch = (row.label_prefix ?? "").toLowerCase().includes(lower);
  return nameMatch || prefixMatch;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const customerId = searchParams.get("customer")?.trim() || null;

  const supabase = createAdminClient();

  let query = supabase
    .from("vw_api_customer_sequences_list")
    .select(
      "id, customer_id, label_prefix, number_format, attributes, start_seq, end_seq, offset_sequence, is_default, created_by, created_date, modified_by, modified_date, customer_num, customer_description",
    )
    .order("created_date", { ascending: false });

  if (customerId) {
    query = query.eq("customer_id", customerId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rawRows = (data ?? []) as Array<Record<string, unknown>>;
  const rowsBase: CustomerSequenceRow[] = rawRows.map((r) => ({
    ...r,
    customer:
      r.customer_num != null || r.customer_description != null
        ? {
            customer_num: (r.customer_num as string) ?? "",
            customer_description: (r.customer_description as string | null) ?? null,
          }
        : null,
  })) as CustomerSequenceRow[];
  const sequenceIds = rowsBase.map((r) => r.id);
  let usedSet = new Set<string>();
  if (sequenceIds.length > 0) {
    const { data: usedRows } = await supabase
      .from("batch")
      .select("customer_sequence_id")
      .in("customer_sequence_id", sequenceIds);
    usedSet = new Set(
      (usedRows ?? [])
        .map((r) => {
          const row = r as Record<string, unknown>;
          return typeof row.customer_sequence_id === "string" ? row.customer_sequence_id : "";
        })
        .filter((v) => v.length > 0),
    );
  }
  const rows: CustomerSequenceRow[] = rowsBase.map((row) => ({
    ...row,
    used_in_batch: usedSet.has(row.id),
  }));

  const filtered = rows.filter((row) => matchesSearch(row, q));

  return NextResponse.json({
    sequences: filtered,
    total_count: rows.length,
  });
}

/** Request body for creating a customer sequence */
export type CreateCustomerSequenceBody = {
  customer_id: string;
  label_prefix?: string | null;
  number_format?: string | null;
  attributes?: Record<string, unknown> | null;
  start_seq?: number | null;
  end_seq?: number | null;
  offset_sequence?: number | null;
  is_default?: boolean | null;
};

function toInt(x: unknown): number | null {
  if (typeof x === "number" && Number.isInteger(x)) return x;
  if (typeof x === "string") {
    const n = parseInt(x, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const customerId =
    typeof raw.customer_id === "string" ? raw.customer_id.trim() : null;

  if (!customerId) {
    return NextResponse.json(
      { error: "customer_id is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: customer, error: custError } = await admin
    .from("customer")
    .select("id")
    .eq("id", customerId)
    .single();

  if (custError || !customer) {
    return NextResponse.json(
      { error: custError?.message ?? "Customer not found" },
      { status: 404 },
    );
  }

  const session = await getSession();
  const userId = session?.userId ?? null;

  const labelPrefix =
    typeof raw.label_prefix === "string" ? raw.label_prefix.trim() || null : null;
  const numberFormat =
    typeof raw.number_format === "string" ? raw.number_format.trim() || null : null;
  const attributes =
    raw.attributes != null && typeof raw.attributes === "object" && !Array.isArray(raw.attributes)
      ? (raw.attributes as Record<string, unknown>)
      : null;
  const startSeq = toInt(raw.start_seq);
  const endSeq = toInt(raw.end_seq);
  const offsetSeq = toInt(raw.offset_sequence);
  const isDefault =
    raw.is_default === true || raw.is_default === "true" || raw.is_default === 1;
  const switchDefault = raw.switch_default === true || raw.switch_default === "true";

  if (offsetSeq === 0) {
    return NextResponse.json(
      { error: "offset_sequence cannot be 0." },
      { status: 400 },
    );
  }

  if (isDefault) {
    const { data: existingDefault } = await admin
      .from("customer_sequence")
      .select("id")
      .eq("customer_id", customerId)
      .eq("is_default", true)
      .maybeSingle();
    if (existingDefault && !switchDefault) {
      return NextResponse.json(
        {
          error:
            "This customer already has a default sequence. Do you want to switch the default to this one?",
          code: "DEFAULT_EXISTS",
        },
        { status: 409 },
      );
    }
    if (existingDefault && switchDefault) {
      await admin
        .from("customer_sequence")
        .update({ is_default: false })
        .eq("customer_id", customerId);
    }
  }

  const { data: seq, error: insertError } = await admin
    .from("customer_sequence")
    .insert({
      customer_id: customerId,
      label_prefix: labelPrefix,
      number_format: numberFormat,
      attributes: attributes,
      start_seq: startSeq ?? 1,
      end_seq: endSeq ?? null,
      offset_sequence: offsetSeq ?? 1,
      is_default: isDefault,
      created_by: userId,
      modified_by: userId,
    })
    .select("id, customer_id, label_prefix, number_format, start_seq, end_seq, offset_sequence, is_default, created_date")
    .single();

  if (insertError || !seq) {
    if (insertError?.code === "23505") {
      return NextResponse.json(
        {
          error:
            "A sequence with this customer, label prefix, and number format already exists.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create customer sequence" },
      { status: 500 },
    );
  }

  return NextResponse.json(seq, { status: 201 });
}
