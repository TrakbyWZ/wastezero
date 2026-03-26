import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Build cleaned CSV with same headers and column order as Preview modal. */
type LogEntryRow = {
  log_file_header: string | null;
  job_name: string | null;
  job_number: string | null;
  operator: string | null;
  job_start_timestamp: string | null;
  job_end_timestamp: string | null;
  data_value: string;
  data_timestamp: string | null;
  sort_order: number;
  is_duplicate: boolean;
};

function recordsToCsv(records: LogEntryRow[]): string {
  const header = "#,Log File Header,Job Name,Job Number,Operator,Job Start Timestamp,Job End Timestamp,Data,Timestamp,Duplicate";
  const rows = records.map((r, i) => {
    const dataTs = r.data_timestamp ?? "";
    const jobStartTs = r.job_start_timestamp ?? "";
    const jobEndTs = r.job_end_timestamp ?? "";
    return [
      String(r.sort_order + 1),
      escapeCsv(r.log_file_header ?? ""),
      escapeCsv(r.job_name ?? ""),
      escapeCsv(r.job_number ?? ""),
      escapeCsv(r.operator ?? ""),
      escapeCsv(jobStartTs),
      escapeCsv(jobEndTs),
      escapeCsv(r.data_value),
      escapeCsv(dataTs),
      r.is_duplicate ? "Yes" : "No",
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

function escapeCsv(value: string): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n"))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "cleaned"; // "original" | "cleaned"

  const admin = createAdminClient();

  const { data: file, error: fileError } = await admin
    .from("log_files")
    .select("id, filename, raw_content")
    .eq("id", id)
    .single();

  if (fileError || !file) {
    return NextResponse.json(
      { error: fileError?.message ?? "File not found" },
      { status: 404 },
    );
  }

  const disposition = `attachment; filename="${file.filename.replace(/\.(txt|csv)$/i, "")}.csv"`;

  if (format === "original" && file.raw_content) {
    return new NextResponse(file.raw_content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": disposition.replace(".csv", ".txt"),
      },
    });
  }

  const { data: entries } = await admin
    .from("log_entries")
    .select("log_file_header, job_name, job_number, operator, job_start_timestamp, job_end_timestamp, data_value, data_timestamp, sort_order, is_duplicate")
    .eq("log_file_id", id)
    .order("sort_order", { ascending: true });

  const toIso = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "object" && v instanceof Date) return v.toISOString();
    return String(v);
  };

  const rows: LogEntryRow[] = (entries ?? []).map((e: Record<string, unknown>) => ({
    log_file_header: (e.log_file_header as string | null) ?? null,
    job_name: (e.job_name as string | null) ?? null,
    job_number: (e.job_number as string | null) ?? null,
    operator: (e.operator as string | null) ?? null,
    job_start_timestamp: toIso(e.job_start_timestamp),
    job_end_timestamp: toIso(e.job_end_timestamp),
    data_value: (e.data_value as string) ?? "",
    data_timestamp: toIso(e.data_timestamp),
    sort_order: typeof e.sort_order === "number" ? e.sort_order : 0,
    is_duplicate: e.is_duplicate === true,
  }));
  const csv = recordsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
    },
  });
}
