import { createAdminClient } from "@/lib/supabase/admin";
import {
  IngestValidationError,
  ingestLogFile,
} from "@/lib/log-ingest";
import {
  DEFAULT_PAGE_SIZE,
  isPageSizeOption,
} from "@/lib/constants/pagination";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeSearchTerm(value: string) {
  return value.replaceAll(",", " ").trim();
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = normalizeSearchTerm(searchParams.get("q") ?? "");
  const fromDate = searchParams.get("from")?.trim() ?? "";
  const toDate = searchParams.get("to")?.trim() ?? "";
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
    .from("log_files")
    .select("id, filename, upload_timestamp, total_reads, bad_reads, sequence_reads, uploaded_by")
    .order("upload_timestamp", { ascending: false })
    .order("id", { ascending: false })
    .range(fromIndex, toIndex);

  if (q) {
    query = query.or(`filename.ilike.%${q}%,uploaded_by.ilike.%${q}%`);
  }
  if (fromDate) {
    query = query.gte("upload_timestamp", `${fromDate}T00:00:00.000Z`);
  }
  if (toDate) {
    query = query.lte("upload_timestamp", `${toDate}T23:59:59.999Z`);
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawText: string;
  let filename: string;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing or invalid file" }, { status: 400 });
    }
    filename = file.name || "upload.txt";
    rawText = await file.text();
  } else if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.content !== "string") {
      return NextResponse.json(
        { error: "JSON body must include content (string)" },
        { status: 400 },
      );
    }
    rawText = body.content;
    filename = (body.filename && String(body.filename)) || "pasted.txt";
  } else {
    return NextResponse.json(
      { error: "Use multipart/form-data with file or application/json with { content, filename? }" },
      { status: 400 },
    );
  }

  try {
    const ingested = await ingestLogFile({
      filename,
      rawText,
      uploadedBy: user?.email ?? null,
    });

    return NextResponse.json(ingested, { status: 201 });
  } catch (error) {
    if (error instanceof IngestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to ingest log file" },
      { status: 500 },
    );
  }
}
