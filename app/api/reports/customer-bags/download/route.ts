import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type CustomerBagsExportRow = {
  customer_id: string | null;
  customer_num: string | null;
  customer_description: string | null;
  label_prefix: string | null;
  customer_sequence_id: string | null;
  cam1_log_file_id: string;
  cam1_filename: string | null;
  cam1_upload_timestamp: string | null;
  cam1_job_start_timestamp: string | null;
  cam1_job_end_timestamp: string | null;
  cam1_data_value: string | null;
  cam1_data_timestamp: string | null;
  data_value: string | null;
  data_timestamp: string | null;
};

const EXPORT_COLUMNS =
  "customer_id,customer_num,customer_description,label_prefix,customer_sequence_id,cam1_log_file_id,cam1_filename,cam1_upload_timestamp,cam1_job_start_timestamp,cam1_job_end_timestamp,cam1_data_value,cam1_data_timestamp,data_value,data_timestamp";

function escapeCsv(value: string): string {
  const normalized = String(value ?? "");
  if (
    normalized.includes(",") ||
    normalized.includes('"') ||
    normalized.includes("\n")
  ) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function buildCustomerBagsCsv(rows: CustomerBagsExportRow[]) {
  const header = [
    "Customer ID",
    "Customer Num",
    "Customer Description",
    "Label Prefix",
    "Customer Sequence ID",
    "Log File ID",
    "Filename",
    "Upload Timestamp",
    "Job Start Timestamp",
    "Job End Timestamp",
    "Parent Camera Data Value",
    "Parent Camera Data Timestamp",
    "Child Camera Data Value",
    "Child Camera Data Timestamp",
  ].join(",");

  const body = rows.map((row) =>
    [
      escapeCsv(row.customer_id ?? ""),
      escapeCsv(row.customer_num ?? ""),
      escapeCsv(row.customer_description ?? ""),
      escapeCsv(row.label_prefix ?? ""),
      escapeCsv(row.customer_sequence_id ?? ""),
      escapeCsv(row.cam1_log_file_id),
      escapeCsv(row.cam1_filename ?? ""),
      escapeCsv(row.cam1_upload_timestamp ?? ""),
      escapeCsv(row.cam1_job_start_timestamp ?? ""),
      escapeCsv(row.cam1_job_end_timestamp ?? ""),
      escapeCsv(row.data_value ?? ""),
      escapeCsv(row.data_timestamp ?? ""),
      escapeCsv(row.cam1_data_value ?? ""),
      escapeCsv(row.cam1_data_timestamp ?? ""),
    ].join(","),
  );

  return [header, ...body].join("\n");
}

function buildFilename(customerNum: string | null, fromDate: string, toDate: string) {
  const customerPart = (customerNum?.trim() || "customer").replace(/[^A-Za-z0-9_-]+/g, "-");
  return `customer-bags-${customerPart}-${fromDate}-to-${toDate}.csv`;
}

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
    .select(EXPORT_COLUMNS)
    .eq("customer_id", customerId)
    .gte("cam1_job_start_timestamp", `${fromDate}T00:00:00.000Z`)
    .lte("cam1_job_start_timestamp", `${toDate}T23:59:59.999Z`)
    .order("page_key", { ascending: false });

  if (labelPrefix) {
    query = query.eq("label_prefix", labelPrefix);
  }
  if (filename) {
    query = query.ilike("cam1_filename", `%${filename}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as CustomerBagsExportRow[];
  const csv = buildCustomerBagsCsv(rows);
  const exportFilename = buildFilename(rows[0]?.customer_num ?? null, fromDate, toDate);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename}"`,
    },
  });
}
