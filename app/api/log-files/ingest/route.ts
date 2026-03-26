import {
  IngestValidationError,
  ingestLogFile,
} from "@/lib/log-ingest";
import { NextResponse } from "next/server";

/**
 * Ingest endpoint for the Windows file upload service (and other automated clients).
 * Authenticated via X-API-Key header. Set LOG_FILES_INGEST_API_KEY in the server environment.
 * Accepts JSON: { content: string, filename?: string }.
 * Returns 200 or 201 on success.
 */
export async function POST(request: Request) {
  const apiKey = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const configuredKey = process.env.LOG_FILES_INGEST_API_KEY ?? process.env.SYNCED_FILES_INGEST_API_KEY;

  if (!configuredKey) {
    return NextResponse.json(
      { error: "Ingest API key not configured (LOG_FILES_INGEST_API_KEY)" },
      { status: 503 },
    );
  }
  if (apiKey !== configuredKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawText: string;
  let filename: string;
  try {
    const body = await request.json();
    if (!body || typeof body.content !== "string") {
      return NextResponse.json(
        { error: "JSON body must include content (string)" },
        { status: 400 },
      );
    }
    rawText = body.content;
    filename = (body.filename && String(body.filename)) || "upload.txt";
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  try {
    const ingested = await ingestLogFile({ filename, rawText });
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
