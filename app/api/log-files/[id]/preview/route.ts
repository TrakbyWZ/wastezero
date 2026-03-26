import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PAGE_SIZE, isPageSizeOption } from "@/lib/constants/pagination";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
  const limitParam = searchParams.get("limit");
  const pageParam = searchParams.get("page");
  const duplicateFilter = searchParams.get("duplicate_filter") ?? "all"; // "all" | "duplicates" | "non_duplicates"
  const requestedLimit = Number(limitParam);
  const limit = isPageSizeOption(requestedLimit)
    ? requestedLimit
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, parseInt(String(pageParam), 10) || 1);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const admin = createAdminClient();

  const { data: file, error: fileError } = await admin
    .from("log_files")
    .select("id, filename, total_reads, bad_reads, sequence_reads, duplicate_count, uploaded_by")
    .eq("id", id)
    .single();

  if (fileError || !file) {
    return NextResponse.json(
      { error: fileError?.message ?? "File not found" },
      { status: 404 },
    );
  }

  let query = admin
    .from("log_entries")
    .select("log_file_header, job_name, job_number, operator, job_start_timestamp, job_end_timestamp, data_value, data_timestamp, sort_order, is_duplicate")
    .eq("log_file_id", id);

  if (duplicateFilter === "duplicates") {
    query = query.eq("is_duplicate", true);
  } else if (duplicateFilter === "non_duplicates") {
    query = query.eq("is_duplicate", false);
  }

  const { data: entries } = await query
    .order("sort_order", { ascending: true })
    .range(from, to);

  type Entry = {
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
  const first = (entries ?? [])[0] as Entry | undefined;
  const records = (entries ?? []).map((e: Entry) => ({
    log_file_header: e.log_file_header,
    job_name: e.job_name,
    job_number: e.job_number,
    operator: e.operator,
    job_start_timestamp: e.job_start_timestamp ?? null,
    job_end_timestamp: e.job_end_timestamp ?? null,
    data_value: e.data_value,
    data_timestamp: e.data_timestamp,
    sort_order: e.sort_order,
    is_duplicate: e.is_duplicate === true,
  }));

  const totalCount = duplicateFilter === "duplicates"
    ? file.duplicate_count
    : duplicateFilter === "non_duplicates"
      ? Math.max(file.total_reads - file.duplicate_count, 0)
      : file.total_reads;

  return NextResponse.json({
    file: {
      id: file.id,
      filename: file.filename,
      job_name: first?.job_name ?? null,
      job_number: first?.job_number ?? null,
      operator: first?.operator ?? null,
      total_reads: file.total_reads,
      bad_reads: file.bad_reads,
      sequence_reads: file.sequence_reads ?? 0,
      duplicate_count: file.duplicate_count ?? 0,
      uploaded_by: file.uploaded_by ?? null,
    },
    records,
    limit,
    page,
    total_count: totalCount,
    duplicate_filter: duplicateFilter,
  });
}
