/**
 * Pressure-test log file ingest and duplicate handling (log_entry_eligible_value_counts + finalize).
 * Uses real camera rows from sampledata (default: 2.13.26__C + 2.13.26__P); only timestamps are
 * shifted per upload so each run replays the same data_values with a different timeline.
 *
 * Usage:
 *   pnpm test:log-ingest-pressure -- --local --files 5
 *   pnpm test:log-ingest-pressure -- --http --local --base-url http://localhost:3000 --files 10
 *   pnpm test:log-ingest-pressure -- --local --cleanup
 *
 * Env: same as before (SUPABASE_* for direct; LOG_FILES_INGEST_API_KEY for http).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createAdminClient } from "../lib/supabase/admin";
import { ingestLogFile } from "../lib/log-ingest";

const FILENAME_PREFIX = "pressure-test-";

const DEFAULT_CAM1 = join("sampledata", "2.13.26__C.txt");
const DEFAULT_CAM2 = join("sampledata", "2.13.26__P.txt");

/** Two-column data row: Camera_N_Data,timestamp */
const DATA_ROW =
  /^([^,]+),(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})\s*$/;

/** Job Start / Job End metadata lines */
const JOB_TS_LINE =
  /^((?:Job Start|Job End):\s*)(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})\s*$/i;

function loadEnvFile(filename: string) {
  const envPath = join(process.cwd(), filename);
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`Invalid ${name}: expected positive integer, got ${raw}`);
    process.exit(1);
  }
  return n;
}

function parseNonNegInt(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Invalid ${name}: expected non-negative integer, got ${raw}`);
    process.exit(1);
  }
  return n;
}

function parseLogTimestampToDate(ts: string): Date {
  const m = ts.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) {
    throw new Error(`Unparseable log timestamp: ${ts}`);
  }
  const [, mo, d, y, h, mi, s] = m;
  return new Date(
    parseInt(y!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(d!, 10),
    parseInt(h!, 10),
    parseInt(mi!, 10),
    parseInt(s!, 10),
  );
}

/** Match sample style: M/D/YYYY H:MM:SS (no leading zero on hour). */
function formatLogTimestamp(d: Date): string {
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const y = d.getFullYear();
  const h = d.getHours();
  const mi = d.getMinutes();
  const s = d.getSeconds();
  return `${mo}/${day}/${y} ${h}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shiftTimestampInLine(line: string, offsetMs: number): string {
  const data = line.match(DATA_ROW);
  if (data) {
    const t = parseLogTimestampToDate(data[2]!);
    const shifted = new Date(t.getTime() + offsetMs);
    return `${data[1]},${formatLogTimestamp(shifted)}`;
  }
  const job = line.match(JOB_TS_LINE);
  if (job) {
    const t = parseLogTimestampToDate(job[2]!);
    const shifted = new Date(t.getTime() + offsetMs);
    return `${job[1]}${formatLogTimestamp(shifted)}`;
  }
  return line;
}

/** Apply the same delta to every parseable timestamp in the file (data rows + Job Start/End). */
function applyTimestampOffset(raw: string, offsetMs: number): string {
  return raw
    .split(/\r?\n/)
    .map((line) => shiftTimestampInLine(line, offsetMs))
    .join("\n");
}

function resolvePath(p: string): string {
  return join(process.cwd(), p);
}

function loadSampleTemplate(cam1Rel: string, cam2Rel: string | null): string {
  const cam1Path = resolvePath(cam1Rel);
  if (!existsSync(cam1Path)) {
    throw new Error(`Camera 1 sample not found: ${cam1Path}`);
  }
  const cam1 = readFileSync(cam1Path, "utf-8");
  if (!cam2Rel) {
    return cam1;
  }
  const cam2Path = resolvePath(cam2Rel);
  if (!existsSync(cam2Path)) {
    throw new Error(`Camera 2 sample not found: ${cam2Path}`);
  }
  const cam2 = readFileSync(cam2Path, "utf-8");
  return `${cam1.trimEnd()}\n\n${cam2.trim()}\n`;
}

/** First eligible (non–Bad_Read) data value from two-column rows — for --verify. */
function firstVerifyDataValueFromTemplate(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(DATA_ROW);
    if (!m) continue;
    const dv = m[1]!.trim();
    if (!dv || dv.toLowerCase() === "bad_read") continue;
    if (dv === "Bad Read" || dv === "Bad_Read") continue;
    return dv;
  }
  return null;
}

type IngestTimings = {
  filename: string;
  ms: number;
  total_reads: number;
  duplicate_count: number;
  bad_reads: number;
};

async function ingestViaHttp(
  baseUrl: string,
  apiKey: string,
  filename: string,
  content: string,
): Promise<IngestTimings> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/log-files/ingest`;
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ filename, content }),
  });
  const ms = performance.now() - t0;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text) as {
    total_reads: number;
    duplicate_count: number;
    bad_reads: number;
  };
  return {
    filename,
    ms,
    total_reads: body.total_reads,
    duplicate_count: body.duplicate_count,
    bad_reads: body.bad_reads,
  };
}

function summarizeMs(samples: number[]) {
  if (samples.length === 0) return { min: 0, max: 0, avg: 0, p95: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    p95: sorted[p95Idx]!,
  };
}

async function verifyCountTable(sampleDataValue: string) {
  const admin = createAdminClient();
  const { data: countRow, error: e1 } = await admin
    .from("log_entry_eligible_value_counts")
    .select("cnt")
    .eq("data_value", sampleDataValue)
    .maybeSingle();

  if (e1) throw new Error(e1.message);

  const { count: entryCount, error: e2 } = await admin
    .from("log_entries")
    .select("*", { count: "exact", head: true })
    .eq("data_value", sampleDataValue);

  if (e2) throw new Error(e2.message);

  const cnt = countRow?.cnt ?? null;
  const eligibleActual = entryCount ?? 0;
  const match = cnt !== null && BigInt(cnt) === BigInt(eligibleActual);

  console.log("\n--- Verify log_entry_eligible_value_counts ---");
  console.log(`Sample data_value: ${sampleDataValue}`);
  console.log(`  counts.cnt:           ${cnt ?? "(missing row)"}`);
  console.log(`  log_entries rows:      ${eligibleActual}`);

  if (!match) {
    console.error("MISMATCH: cnt should equal number of log_entries for this value.");
    process.exit(1);
  }
  console.log("OK counts table matches log_entries row count for sample value.");
}

async function cleanupPressureFiles() {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("log_files")
    .select("id, filename")
    .like("filename", `${FILENAME_PREFIX}%`);

  if (error) throw new Error(error.message);
  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) {
    console.log("No pressure-test log files to delete.");
    return;
  }
  const { error: delErr } = await admin.from("log_files").delete().in("id", ids);
  if (delErr) throw new Error(delErr.message);
  console.log(`Deleted ${ids.length} log file(s) matching ${FILENAME_PREFIX}*.`);
}

async function main() {
  const useLocal = hasFlag("--local");
  const useLinked = hasFlag("--linked");
  const cleanupOnly = hasFlag("--cleanup");
  const httpMode = hasFlag("--http");

  const loadProjectEnv = () => {
    if (useLocal === useLinked) {
      console.error("Pass exactly one of --local or --linked to load env from the project root.");
      process.exit(1);
    }
    loadEnvFile(useLocal ? ".env.local" : ".env.prod.local");
  };

  if (cleanupOnly) {
    loadProjectEnv();
    await cleanupPressureFiles();
    return;
  }

  if (httpMode) {
    if (useLocal || useLinked) {
      loadProjectEnv();
    }
  } else {
    loadProjectEnv();
  }

  const baseUrl = argValue("--base-url") ?? "http://localhost:3000";
  const apiKey =
    argValue("--api-key") ??
    process.env.LOG_FILES_INGEST_API_KEY ??
    process.env.SYNCED_FILES_INGEST_API_KEY;

  const files = parsePositiveInt("--files", 3);
  const concurrency = Math.min(files, parsePositiveInt("--concurrency", 1));
  const verify = hasFlag("--verify");

  const cam1Path = argValue("--sample-cam1") ?? DEFAULT_CAM1;
  const cam2Path = hasFlag("--cam1-only") ? null : (argValue("--sample-cam2") ?? DEFAULT_CAM2);

  const skewMinutes = parseNonNegInt("--time-skew-minutes", 24 * 60);

  if (httpMode && !apiKey) {
    console.error("HTTP mode requires LOG_FILES_INGEST_API_KEY (or --api-key).");
    process.exit(1);
  }

  if (!httpMode) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      console.error("Direct mode requires SUPABASE_URL and SUPABASE_SECRET_KEY in env.");
      process.exit(1);
    }
  }

  const baseTemplate = loadSampleTemplate(cam1Path, cam2Path);
  const verifyValue = firstVerifyDataValueFromTemplate(baseTemplate);

  console.log("Pressure test config:", {
    mode: httpMode ? "http" : "direct",
    baseUrl: httpMode ? baseUrl : "(ingestLogFile)",
    files,
    sampleCam1: cam1Path,
    sampleCam2: cam2Path ?? "(cam1 only)",
    timeSkewMinutesPerFile: skewMinutes,
    concurrency,
    verify,
    verifySampleValue: verifyValue ?? "(none found)",
  });

  const timings: IngestTimings[] = [];

  const runOne = async (i: number) => {
    const jobTag = `${Date.now()}-${i}`;
    const filename = `${FILENAME_PREFIX}${jobTag}.txt`;
    const offsetMs = i * skewMinutes * 60 * 1000;
    const content = applyTimestampOffset(baseTemplate, offsetMs);

    if (httpMode) {
      return ingestViaHttp(baseUrl!, apiKey!, filename, content);
    }

    const t0 = performance.now();
    const result = await ingestLogFile({
      filename,
      rawText: content,
      uploadedBy: "pressure-test-log-ingest",
    });
    const ms = performance.now() - t0;
    return {
      filename,
      ms,
      total_reads: result.total_reads,
      duplicate_count: result.duplicate_count,
      bad_reads: result.bad_reads,
    };
  };

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= files) break;
      const row = await runOne(i);
      timings.push(row);
      console.log(
        `  [${i + 1}/${files}] ${row.filename}  ${row.ms.toFixed(0)} ms  reads=${row.total_reads} dup=${row.duplicate_count} bad=${row.bad_reads}`,
      );
    }
  }

  const tWall0 = performance.now();
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const wallMs = performance.now() - tWall0;

  const msSamples = timings.map((t) => t.ms);
  const stat = summarizeMs(msSamples);

  console.log("\n--- Summary ---");
  console.log(`Wall time (batch):     ${wallMs.toFixed(0)} ms`);
  console.log(`Per-file ingest (ms):  min=${stat.min.toFixed(0)} avg=${stat.avg.toFixed(0)} p95=${stat.p95.toFixed(0)} max=${stat.max.toFixed(0)}`);
  console.log(
    `Duplicate counts:      min=${Math.min(...timings.map((t) => t.duplicate_count))} max=${Math.max(...timings.map((t) => t.duplicate_count))}`,
  );

  if (verify) {
    if (httpMode) {
      console.warn("--verify requires direct DB access; load env and omit --http, or run verify separately.");
    } else if (!verifyValue) {
      console.warn("--verify skipped: no eligible data row found in sample template.");
    } else {
      await verifyCountTable(verifyValue);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
