import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export type CustomerSequenceResponse = {
  offset_sequence: number | null;
  label_prefix: string | null;
  number_format: string | null;
};

/**
 * GET /api/customers/[id]/sequence
 * Returns the sequencing pattern for the customer from customer_sequence (offset, label prefix, number format).
 * Used by the New Batch modal to show which sequence is applied.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "Customer ID required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from("vw_api_customer_sequence_for_customer")
    .select("offset_sequence, label_prefix, number_format")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rawOffset = row?.offset_sequence;
  const offset_sequence =
    rawOffset != null && Number.isInteger(rawOffset) && rawOffset > 0
      ? rawOffset
      : null;

  const label_prefix =
    typeof row?.label_prefix === "string" ? row.label_prefix.trim() || null : null;
  const number_format =
    typeof row?.number_format === "string" ? row.number_format.trim() || null : null;

  const result: CustomerSequenceResponse = {
    offset_sequence,
    label_prefix,
    number_format,
  };
  return NextResponse.json(result);
}
