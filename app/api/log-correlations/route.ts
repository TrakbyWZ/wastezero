import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_PAGE_SIZE,
  isPageSizeOption,
} from "@/lib/constants/pagination";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
  const childLogFileId = searchParams.get("child_log_file_id")?.trim() ?? "";
  const fromDate = searchParams.get("from")?.trim() ?? "";
  const toDate = searchParams.get("to")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const pageParam = Number(searchParams.get("page") ?? "1");
  const pageSizeParam = Number(searchParams.get("page_size") ?? String(DEFAULT_PAGE_SIZE));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageSize = isPageSizeOption(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize;

  const admin = createAdminClient();

  let query = admin.from("vw_api_log_correlations").select("*");

  // Scoped to one file (the Quality Control detail screen): order by the
  // row's actual physical position in the file (child_sort_order, from
  // log_entries.sort_order) so QC can tell reading order and which row is
  // first - sorting by code text (the general-purpose order below) doesn't
  // reflect that at all. Inferred rows have no sort_order (no backing
  // log_entries row) and sort last; effective_child_code is a tiebreaker
  // for same-position cases, which shouldn't occur but costs nothing to
  // guard.
  if (childLogFileId) {
    query = query
      .order("child_sort_order", { ascending: true, nullsFirst: false })
      .order("effective_child_code", { ascending: true });
  } else {
    query = query
      .order("job_date", { ascending: false })
      .order("job_name", { ascending: true })
      .order("effective_child_code", { ascending: true });
  }

  query = query.range(fromIndex, toIndex);

  if (jobName) {
    query = query.eq("job_name", jobName);
  }
  if (jobNumber) {
    query = query.eq("job_number", jobNumber);
  }
  if (customerId) {
    query = query.eq("customer_id", customerId);
  }
  if (childLogFileId) {
    query = query.eq("child_log_file_id", childLogFileId);
  }
  if (fromDate) {
    query = query.gte("job_date", fromDate);
  }
  if (toDate) {
    query = query.lte("job_date", toDate);
  }
  // "unresolved" mirrors vw_api_log_correlation_files.unresolved_count's
  // predicate (and log_correlations_pending_gap_fill_idx's) exactly: a real
  // row the gap-fill sweep still considers worth attempting or has given
  // up on.
  if (status === "unresolved") {
    query = query
      .eq("is_inferred", false)
      .is("usr_child_code", null)
      .is("overridden_by", null)
      .or("child_code.is.null,child_code.eq.Bad_Read");
  } else if (status === "excluded") {
    query = query.eq("usr_exclude_row", true);
  } else if (status === "inferred") {
    query = query.eq("is_inferred", true);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const records = (rows ?? []).slice(0, pageSize);

  return NextResponse.json({
    rows: records,
    page,
    page_size: pageSize,
    has_more: (rows ?? []).length > pageSize,
  });
}
