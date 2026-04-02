import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { generateSequence, formatSequenceToCsv } from "@/lib/sequence";
import { batchCsvFilename } from "@/app/api/batches/route";
import { NextResponse } from "next/server";

/**
 * GET /api/batches/[id]/download — Returns a CSV file with one value per line.
 * Each value is the batch's label prefix + sequence number padded by the batch's number format
 * (e.g. prefix "ABC" + format "0000000" → ABC0000001, ABC0000010, ...).
 * Uses batch.filename for the download filename and records the download in batch_downloads for audit.
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

  const { id: batchId } = await params;
  if (!batchId) {
    return NextResponse.json({ error: "Batch ID required" }, { status: 400 });
  }

  const session = await getSession();
  const admin = createAdminClient();

  const { data: batch, error: batchError } = await admin
    .from("batch")
    .select(
      "id, created_date, start_sequence, end_sequence, offset_sequence, filename, customer:customer_id(customer_num, customer_description), customer_sequence:customer_sequence_id(label_prefix, number_format)",
    )
    .eq("id", batchId)
    .single();

  if (batchError || !batch) {
    return NextResponse.json(
      { error: batchError?.message ?? "Batch not found" },
      { status: 404 },
    );
  }

  const startSeq = batch.start_sequence;
  const endSeq = batch.end_sequence;
  const offsetSeq = batch.offset_sequence;

  if (
    startSeq == null ||
    endSeq == null ||
    offsetSeq == null ||
    offsetSeq === 0 ||
    (offsetSeq > 0 && endSeq < startSeq) ||
    (offsetSeq < 0 && endSeq > startSeq)
  ) {
    return NextResponse.json(
      { error: "Batch has invalid sequence parameters" },
      { status: 400 },
    );
  }

  const sequence = generateSequence(startSeq, endSeq, offsetSeq);
  const customerSequence = batch.customer_sequence as unknown as {
    label_prefix: string | null;
    number_format: string | null;
  } | null;
  const labelPrefix = customerSequence?.label_prefix ?? null;
  const numberFormat = customerSequence?.number_format ?? null;
  const csv = formatSequenceToCsv(sequence, labelPrefix, numberFormat);
  const filename =
    batch.filename ||
    (() => {
      const createdAt = batch.created_date ? new Date(batch.created_date) : new Date();
      const customer = batch.customer as unknown as { customer_num: string; customer_description: string | null } | null;
      const customerNum = customer?.customer_num ?? "customer";
      return batchCsvFilename(customerNum, createdAt);
    })();

  await admin.from("batch_downloads").insert({
    batch_id: batch.id,
    user_id: session?.userId ?? null,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
