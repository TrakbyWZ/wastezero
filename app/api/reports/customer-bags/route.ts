import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_PAGE_SIZE,
  isPageSizeOption,
} from "@/lib/constants/pagination";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const XREF_COLUMNS =
  "page_key,customer_id,customer_num,customer_description,label_prefix,customer_sequence_id,cam1_log_file_id,cam1_filename,cam1_upload_timestamp,cam1_job_name,cam1_job_start_timestamp,cam1_job_end_timestamp,cam1_data_value,cam1_data_timestamp,data_value,data_timestamp";

export type CustomerBagsXrefRow = {
  customer_id: string | null;
  customer_num: string | null;
  customer_description: string | null;
  label_prefix: string | null;
  customer_sequence_id: string | null;
  cam1_log_file_id: string;
  cam1_filename: string | null;
  cam1_upload_timestamp: string | null;
  cam1_job_name: string | null;
  cam1_job_start_timestamp: string | null;
  cam1_job_end_timestamp: string | null;
  cam1_data_value: string | null;
  cam1_data_timestamp: string | null;
  data_value: string | null;
  data_timestamp: string | null;
};

type CustomerBagsReportRowWithCursor = CustomerBagsXrefRow & {
  page_key: string;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customer")?.trim() || null;
  const fromDate = searchParams.get("from")?.trim() || null;
  const toDate = searchParams.get("to")?.trim() || null;
  const labelPrefix = searchParams.get("label_prefix")?.trim() || null;
  const filename = searchParams.get("filename")?.trim() || null;
  const pageSizeParam = Number(searchParams.get("page_size") ?? String(DEFAULT_PAGE_SIZE));
  const cursor = searchParams.get("cursor")?.trim() || null;
  const pageSize = isPageSizeOption(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;

  if (!customerId || !fromDate || !toDate) {
    return NextResponse.json(
      { error: "Customer, from date, and to date are required." },
      { status: 400 },
    );
  }

  if (fromDate > toDate) {
    return NextResponse.json(
      { error: "From date must be before or equal to to date." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  let query = admin
    .from("report_customer_bags")
    .select(XREF_COLUMNS)
    .order("page_key", { ascending: false })
    .limit(pageSize + 1);

  if (customerId) {
    query = query.eq("customer_id", customerId);
  }
  if (fromDate) {
    const fromTs = `${fromDate}T00:00:00.000Z`;
    query = query.gte("cam1_job_start_timestamp", fromTs);
  }
  if (toDate) {
    const toTs = `${toDate}T23:59:59.999Z`;
    query = query.lte("cam1_job_start_timestamp", toTs);
  }
  if (labelPrefix) {
    query = query.eq("label_prefix", labelPrefix);
  }
  if (filename) {
    query = query.ilike("cam1_filename", `%${filename}%`);
  }
  if (cursor) {
    query = query.lt("page_key", cursor);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pageRows = (rows ?? []) as CustomerBagsReportRowWithCursor[];
  const visibleRows = pageRows.slice(0, pageSize);
  const nextCursor =
    pageRows.length > pageSize
      ? pageRows[pageSize - 1]?.page_key ?? null
      : null;

  return NextResponse.json({
    rows: visibleRows.map((row) => {
      const { page_key: pageKey, ...rest } = row;
      void pageKey;
      return rest;
    }),
    next_cursor: nextCursor,
    page_size: pageSize,
  });
}
