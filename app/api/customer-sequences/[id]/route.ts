import {
  DEFAULT_CUSTOMER_SEQUENCE_NUMBER_FORMAT,
  DEFAULT_CUSTOMER_SEQUENCE_OFFSET_SEQUENCE,
  DEFAULT_CUSTOMER_SEQUENCE_START_SEQ,
} from "@/lib/customer-sequence-defaults";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CustomerSequenceRow } from "@/lib/types";
import { NextResponse } from "next/server";

function toInt(x: unknown): number | null {
  if (typeof x === "number" && Number.isInteger(x)) return x;
  if (typeof x === "string") {
    const n = parseInt(x, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

async function sequenceHasBatches(
  admin: ReturnType<typeof createAdminClient>,
  sequenceId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("batch")
    .select("id")
    .eq("customer_sequence_id", sequenceId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from("vw_api_customer_sequences_list")
    .select(
      "id, customer_id, label_prefix, number_format, attributes, start_seq, end_seq, offset_sequence, is_default, created_by, created_date, modified_by, modified_date, customer_num, customer_description",
    )
    .eq("id", id)
    .single();

  if (error || !row) {
    return NextResponse.json(
      { error: error?.message ?? "Not found" },
      { status: 404 },
    );
  }

  const r = row as Record<string, unknown>;
  const result: CustomerSequenceRow = {
    ...r,
    customer:
      r.customer_num != null || r.customer_description != null
        ? {
            customer_num: (r.customer_num as string) ?? "",
            customer_description: (r.customer_description as string | null) ?? null,
          }
        : null,
  } as CustomerSequenceRow;
  return NextResponse.json(result);
}

/** Request body for updating a customer sequence */
export type UpdateCustomerSequenceBody = {
  label_prefix?: string | null;
  number_format?: string | null;
  attributes?: Record<string, unknown> | null;
  start_seq?: number | null;
  end_seq?: number | null;
  offset_sequence?: number | null;
  is_default?: boolean | null;
};

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
  const labelPrefix =
    raw.label_prefix !== undefined
      ? (typeof raw.label_prefix === "string" ? raw.label_prefix.trim() || null : null)
      : undefined;
  let numberFormat: string | undefined;
  if (raw.number_format !== undefined) {
    numberFormat =
      typeof raw.number_format === "string"
        ? raw.number_format.trim() || DEFAULT_CUSTOMER_SEQUENCE_NUMBER_FORMAT
        : DEFAULT_CUSTOMER_SEQUENCE_NUMBER_FORMAT;
  } else {
    numberFormat = undefined;
  }
  const attributes =
    raw.attributes !== undefined
      ? (raw.attributes != null && typeof raw.attributes === "object" && !Array.isArray(raw.attributes)
          ? (raw.attributes as Record<string, unknown>)
          : null)
      : undefined;
  const startSeq = raw.start_seq !== undefined ? toInt(raw.start_seq) : undefined;
  const endSeq = raw.end_seq !== undefined ? toInt(raw.end_seq) : undefined;
  const offsetSeq = raw.offset_sequence !== undefined ? toInt(raw.offset_sequence) : undefined;
  const isDefault =
    raw.is_default !== undefined
      ? (raw.is_default === true || raw.is_default === "true" || raw.is_default === 1)
      : undefined;
  const switchDefault = raw.switch_default === true || raw.switch_default === "true";

  if (offsetSeq === 0) {
    return NextResponse.json(
      { error: "offset_sequence cannot be 0." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: existingRow, error: existingErr } = await admin
    .from("customer_sequence")
    .select("start_seq, end_seq, offset_sequence")
    .eq("id", id)
    .maybeSingle();
  if (existingErr || !existingRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const mergedOffsetRaw =
    offsetSeq !== undefined ? offsetSeq : existingRow.offset_sequence;
  const mergedOffset =
    mergedOffsetRaw === null || mergedOffsetRaw === undefined
      ? null
      : Number(mergedOffsetRaw);

  let mergedEnd: number | null;
  if (mergedOffset != null && mergedOffset < 0) {
    mergedEnd = 0;
  } else if (endSeq !== undefined) {
    mergedEnd = endSeq;
  } else {
    mergedEnd = existingRow.end_seq;
  }

  let mergedStart: number | null;
  if (startSeq === undefined) {
    mergedStart = existingRow.start_seq;
  } else if (startSeq === null) {
    mergedStart = DEFAULT_CUSTOMER_SEQUENCE_START_SEQ;
  } else {
    mergedStart = startSeq;
  }
  const effectiveStart = mergedStart ?? DEFAULT_CUSTOMER_SEQUENCE_START_SEQ;

  if (
    (mergedOffset == null || mergedOffset >= 0) &&
    mergedEnd == null &&
    effectiveStart < 0
  ) {
    return NextResponse.json(
      {
        error:
          "When end_seq is not set, start_seq must be at least 0 (minimum sequence is zero when there is no end).",
      },
      { status: 400 },
    );
  }

  if (mergedOffset != null && mergedOffset < 0 && effectiveStart < 0) {
    return NextResponse.json(
      {
        error:
          "Descending sequences (negative offset) end at 0; start_seq must be at least 0.",
      },
      { status: 400 },
    );
  }

  const isUsedByBatch = await sequenceHasBatches(admin, id);
  if (isUsedByBatch) {
    return NextResponse.json(
      { error: "Cannot edit: one or more batches already use this sequence." },
      { status: 409 },
    );
  }

  if (isDefault === true) {
    const { data: current } = await admin
      .from("customer_sequence")
      .select("customer_id")
      .eq("id", id)
      .single();
    if (current?.customer_id) {
      const { data: otherDefault } = await admin
        .from("customer_sequence")
        .select("id")
        .eq("customer_id", current.customer_id)
        .eq("is_default", true)
        .neq("id", id)
        .maybeSingle();
      if (otherDefault && !switchDefault) {
        return NextResponse.json(
          {
            error:
              "This customer already has a default sequence. Do you want to switch the default to this one?",
            code: "DEFAULT_EXISTS",
          },
          { status: 409 },
        );
      }
      if (otherDefault && switchDefault) {
        await admin
          .from("customer_sequence")
          .update({ is_default: false })
          .eq("customer_id", current.customer_id)
          .neq("id", id);
      }
    }
  }

  const session = await getSession();

  const updatePayload: Record<string, unknown> = {
    modified_by: session?.userId ?? null,
    modified_date: new Date().toISOString(),
  };
  if (labelPrefix !== undefined) updatePayload.label_prefix = labelPrefix;
  if (numberFormat !== undefined) updatePayload.number_format = numberFormat;
  if (attributes !== undefined) updatePayload.attributes = attributes;
  if (startSeq !== undefined) {
    updatePayload.start_seq =
      startSeq === null ? DEFAULT_CUSTOMER_SEQUENCE_START_SEQ : startSeq;
  }
  if (endSeq !== undefined) updatePayload.end_seq = endSeq;
  if (offsetSeq !== undefined) {
    updatePayload.offset_sequence =
      offsetSeq ?? DEFAULT_CUSTOMER_SEQUENCE_OFFSET_SEQUENCE;
  }
  if (isDefault !== undefined) updatePayload.is_default = isDefault;

  const finalOffset =
    updatePayload.offset_sequence !== undefined
      ? Number(updatePayload.offset_sequence)
      : mergedOffset;
  if (finalOffset != null && finalOffset < 0) {
    updatePayload.end_seq = 0;
  }

  const { data, error } = await admin
    .from("customer_sequence")
    .update(updatePayload)
    .eq("id", id)
    .select("id, customer_id, label_prefix, number_format, start_seq, end_seq, offset_sequence, is_default, modified_date")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "A sequence with this customer, label prefix, and number format already exists.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
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

  const admin = createAdminClient();
  const isUsedByBatch = await sequenceHasBatches(admin, id);
  if (isUsedByBatch) {
    return NextResponse.json(
      { error: "Cannot delete: one or more batches already use this sequence." },
      { status: 409 },
    );
  }

  const { error } = await admin.from("customer_sequence").delete().eq("id", id);

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Cannot delete: one or more batches use this sequence." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
