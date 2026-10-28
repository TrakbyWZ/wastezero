import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const BLOB_PATHNAME = "powerbi/TrakbyWz_Reports.zip";

/**
 * GET /api/powerbi/download — Streams the Power BI project archive to signed-in users.
 * The archive is uploaded by .github/workflows/upload-powerbi-report.yml whenever powerbi/** changes.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await get(BLOB_PATHNAME, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return NextResponse.json(
      { error: "Power BI report is not available" },
      { status: 404 },
    );
  }

  return new NextResponse(result.stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="TrakbyWz_Reports.zip"',
      "Cache-Control": "private, no-cache",
    },
  });
}
