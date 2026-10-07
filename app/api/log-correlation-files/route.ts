import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_PAGE_SIZE,
  isPageSizeOption,
} from "@/lib/constants/pagination";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Backs the Quality Control list screen: one row per child log file with
 * job/customer identity, row-status counts, and latest run status, read
 * from vw_api_log_correlation_files.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobName = searchParams.get("job_name")?.trim() ?? "";
  const jobNumber = searchParams.get("job_number")?.trim() ?? "";
  const customerId = searchParams.get("customer_id")?.trim() ?? "";
  const fromDate = searchParams.get("from")?.trim() ?? "";
  const toDate = searchParams.get("to")?.trim() ?? "";
  const needsAttention = searchParams.get("needs_attention") === "true";
  const pageParam = Number(searchParams.get("page") ?? "1");
  const pageSizeParam = Number(searchParams.get("page_size") ?? String(DEFAULT_PAGE_SIZE));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageSize = isPageSizeOption(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize;

  const admin = createAdminClient();

  let query = admin
    .from("vw_api_log_correlation_files")
    .select("*", { count: "exact" })
    .order("job_date", { ascending: false })
    .order("child_filename", { ascending: true })
    .range(fromIndex, toIndex);

  if (jobName) {
    query = query.eq("job_name", jobName);
  }
  if (jobNumber) {
    query = query.eq("job_number", jobNumber);
  }
  if (customerId) {
    query = query.eq("customer_id", customerId);
  }
  if (fromDate) {
    query = query.gte("job_date", fromDate);
  }
  if (toDate) {
    query = query.lte("job_date", toDate);
  }
  if (needsAttention) {
    query = query.or("unresolved_count.gt.0,excluded_count.gt.0");
  }

  const { data: rows, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const records = (rows ?? []).slice(0, pageSize);
  const totalCount = count ?? null;
  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / pageSize)) : null;

  return NextResponse.json({
    rows: records,
    page,
    page_size: pageSize,
    has_more: (rows ?? []).length > pageSize,
    total_count: totalCount,
    total_pages: totalPages,
  });
}
