import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateSequence, formatSequenceToCsv } from "@/lib/sequence";
import type { BatchRow } from "@/lib/types";
import { NextResponse } from "next/server";

function matchesSearch(row: BatchRow, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  const idMatch = row.id.toLowerCase().includes(lower);
  const cust = row.customer;
  const nameMatch =
    cust?.customer_description?.toLowerCase().includes(lower) ||
    cust?.customer_num?.toLowerCase().includes(lower) ||
    false;
  return idMatch || nameMatch;
}

function inDateRange(
  row: BatchRow,
  fromIso: string | null,
  toIso: string | null,
): boolean {
  if (!fromIso && !toIso) return true;
  const start = row.start_time ? new Date(row.start_time).getTime() : null;
  const created = row.created_date ? new Date(row.created_date).getTime() : null;
  const from = fromIso ? new Date(fromIso).setHours(0, 0, 0, 0) : null;
  const to = toIso
    ? new Date(toIso).setHours(23, 59, 59, 999)
    : null;

  const inRange = (t: number) => {
    if (from != null && t < from) return false;
    if (to != null && t > to) return false;
    return true;
  };
  const startIn = start != null && inRange(start);
  const createdIn = created != null && inRange(created);
  return startIn || createdIn;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const fromDate = searchParams.get("from")?.trim() || null;
  const toDate = searchParams.get("to")?.trim() || null;
  const customerId = searchParams.get("customer")?.trim() || null;

  const supabase = createAdminClient();

  let query = supabase
    .from("vw_api_batches_list")
    .select(
      "id, created_date, start_time, end_time, start_sequence, end_sequence, offset_sequence, label_count, filename, customer_num, customer_description, sequence_label_prefix, sequence_number_format",
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
  const rows: BatchRow[] = rawRows.map((r) => ({
    id: r.id as string,
    created_date: r.created_date as string | null,
    start_time: r.start_time as string | null,
    end_time: r.end_time as string | null,
    start_sequence: r.start_sequence as number | null,
    end_sequence: r.end_sequence as number | null,
    offset_sequence: r.offset_sequence as number | null,
    label_count: r.label_count as number | null,
    filename: r.filename as string | null,
    customer:
      r.customer_num != null || r.customer_description != null
        ? {
            customer_num: (r.customer_num as string) ?? "",
            customer_description: (r.customer_description as string | null) ?? null,
          }
        : null,
    customer_sequence:
      r.sequence_label_prefix != null || r.sequence_number_format != null
        ? {
            label_prefix: (r.sequence_label_prefix as string) ?? null,
            number_format: (r.sequence_number_format as string) ?? null,
          }
        : null,
  }));
  const displayName = (r: BatchRow) =>
    (r.customer?.customer_description ?? r.customer?.customer_num ?? "").toLowerCase();
  rows.sort((a, b) => {
    const na = displayName(a);
    const nb = displayName(b);
    if (na !== nb) return na.localeCompare(nb);
    const da = a.created_date ?? "";
    const db = b.created_date ?? "";
    return db.localeCompare(da);
  });
  const filtered = rows.filter(
    (row) => matchesSearch(row, q) && inDateRange(row, fromDate, toDate),
  );

  return NextResponse.json({
    batches: filtered,
    total_count: rows.length,
  });
}

/** Request body for creating a batch and generating its sequence CSV */
export type CreateBatchBody = {
  customer_id: string;
  customer_label_style_id?: string | null;
  start_sequence: number;
  end_sequence: number;
  offset_sequence: number;
};

function toInt(x: unknown): number | null {
  if (typeof x === "number" && Number.isInteger(x)) return x;
  if (typeof x === "string") {
    const n = parseInt(x, 10);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

/** Filename: {CustomerNumber}_{yyyyMMdd}_{HHmmss}.csv (letters, digits, underscores only in customer number) */
export function batchCsvFilename(customerNum: string, createdAt: Date): string {
  const yyyyMMdd = createdAt.toISOString().slice(0, 10).replace(/-/g, "");
  const hh = String(createdAt.getUTCHours()).padStart(2, "0");
  const mi = String(createdAt.getUTCMinutes()).padStart(2, "0");
  const ss = String(createdAt.getUTCSeconds()).padStart(2, "0");
  const time = `${hh}${mi}${ss}`;
  return `${customerNum}_${yyyyMMdd}_${time}.csv`;
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const customerId = typeof raw.customer_id === "string" ? raw.customer_id.trim() : null;
  const startSeq = toInt(raw.start_sequence);
  const endSeq = toInt(raw.end_sequence);
  const offsetSeq = toInt(raw.offset_sequence);

  if (!customerId) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }
  if (startSeq == null || endSeq == null || offsetSeq == null) {
    return NextResponse.json(
      { error: "start_sequence, end_sequence, and offset_sequence must be integers" },
      { status: 400 },
    );
  }
  if (endSeq <= startSeq) {
    return NextResponse.json({ error: "end_sequence must be greater than start_sequence" }, { status: 400 });
  }
  if (offsetSeq <= 0) {
    return NextResponse.json({ error: "offset_sequence must be greater than 0" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: customer, error: custError } = await admin
    .from("customer")
    .select("id, customer_num, customer_description")
    .eq("id", customerId)
    .single();

  if (custError || !customer) {
    return NextResponse.json(
      { error: custError?.message ?? "Customer not found" },
      { status: 404 },
    );
  }

  const { data: customerSequence, error: seqError } = await admin
    .from("customer_sequence")
    .select("id, label_prefix, number_format")
    .eq("customer_id", customer.id)
    .order("is_default", { ascending: false })
    .order("created_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (seqError || !customerSequence) {
    return NextResponse.json(
      { error: "No customer sequence configured for this customer. Add one in Customer Sequences." },
      { status: 400 },
    );
  }

  const sequence = generateSequence(startSeq, endSeq, offsetSeq);
  const labelCount = sequence.length;
  const startTime = new Date().toISOString();
  const createdAt = new Date(startTime);
  const csvFilename = batchCsvFilename(customer.customer_num, createdAt);

  const session = await getSession();
  const userId = session?.userId ?? null;

  const { data: batch, error: insertError } = await admin
    .from("batch")
    .insert({
      customer_id: customer.id,
      customer_sequence_id: customerSequence.id,
      start_sequence: startSeq,
      end_sequence: endSeq,
      offset_sequence: offsetSeq,
      label_count: labelCount,
      start_time: startTime,
      filename: csvFilename,
      created_by: userId,
      modified_by: userId,
    })
    .select("id, created_date")
    .single();

  if (insertError || !batch) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create batch" },
      { status: 500 },
    );
  }

  const labelPrefix = customerSequence.label_prefix ?? null;
  const numberFormat = customerSequence.number_format ?? null;
  const csv = formatSequenceToCsv(sequence, labelPrefix, numberFormat);
  const filename = csvFilename;

  await admin.from("batch_downloads").insert({
    batch_id: batch.id,
    user_id: userId,
  });

  return new NextResponse(csv, {
    status: 201,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
