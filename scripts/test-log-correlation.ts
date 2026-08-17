/**
 * Standalone test for run_log_correlation() (supabase/migrations/2026081612*).
 * Connects directly to a real Postgres instance (local or linked) via the
 * admin client and RPC, since this feature is pure SQL/plpgsql, not a
 * TypeScript module.
 *
 * Usage:
 *   pnpm test:log-correlation -- --local
 *   pnpm test:log-correlation -- --linked
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createAdminClient } from "../lib/supabase/admin";

const TEST_CUSTOMER_NUM = "TESTLOGCORR";
const TEST_FILE_PREFIX = "test-log-correlation-";
const JOB_NAME = "Evergreen0416";
const JOB_NUMBER = "EVG-0416";
const JOB_START = "2026-04-16T10:30:00.000Z";
const JOB_END = "2026-04-16T10:35:00.000Z";

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
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log("OK  ", message);
  } else {
    console.error("FAIL:", message);
    failures++;
  }
}

function tsAt(secondsOffset: number): string {
  return new Date(new Date(JOB_START).getTime() + secondsOffset * 1000).toISOString();
}

async function main() {
  const useLocal = hasFlag("--local");
  const useLinked = hasFlag("--linked");
  if (useLocal === useLinked) {
    console.error("Pass exactly one of --local or --linked.");
    process.exit(1);
  }
  loadEnvFile(useLocal ? ".env.local" : ".env.prod.local");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY in env.");
    process.exit(1);
  }

  const admin = createAdminClient();

  // --- Cleanup any previous run's data ---
  await admin.from("log_files").delete().like("filename", `${TEST_FILE_PREFIX}%`);
  await admin.from("customer").delete().eq("customer_num", TEST_CUSTOMER_NUM);

  // --- Seed customer + customer_sequence ---
  const { data: customer, error: customerErr } = await admin
    .from("customer")
    .insert({ customer_num: TEST_CUSTOMER_NUM, customer_description: "Log correlation test customer" })
    .select("id")
    .single();
  if (customerErr || !customer) throw new Error(`Failed to seed customer: ${customerErr?.message}`);

  const { data: customerSequence, error: seqErr } = await admin
    .from("customer_sequence")
    .insert({
      customer_id: customer.id,
      label_prefix: "R005C",
      number_format: "0000000",
      start_seq: 1,
      end_seq: 9999999,
      offset_sequence: 1,
      is_default: true,
    })
    .select("id")
    .single();
  if (seqErr || !customerSequence) throw new Error(`Failed to seed customer_sequence: ${seqErr?.message}`);

  // --- Seed log_files ---
  const { data: cam1File, error: cam1FileErr } = await admin
    .from("log_files")
    .insert({
      filename: `${TEST_FILE_PREFIX}cam1.txt`,
      upload_timestamp: JOB_START,
      total_reads: 0,
      bad_reads: 0,
      sequence_reads: 0,
      uploaded_by: "test-log-correlation",
      raw_content: "",
    })
    .select("id")
    .single();
  if (cam1FileErr || !cam1File) throw new Error(`Failed to seed camera1 log_files row: ${cam1FileErr?.message}`);

  const { data: cam2File, error: cam2FileErr } = await admin
    .from("log_files")
    .insert({
      filename: `${TEST_FILE_PREFIX}cam2.txt`,
      upload_timestamp: JOB_START,
      total_reads: 0,
      bad_reads: 0,
      sequence_reads: 0,
      uploaded_by: "test-log-correlation",
      raw_content: "",
    })
    .select("id")
    .single();
  if (cam2FileErr || !cam2File) throw new Error(`Failed to seed camera2 log_files row: ${cam2FileErr?.message}`);

  // --- Seed log_entries ---
  // Camera1: 177-190 (matches content/docs/data-correlation.md sample), plus
  // 195 (trailing beyond the last camera2 parent -> unresolved parent, but
  // customer still resolves) and one non-matching-prefix code (unresolved
  // parent AND unresolved customer).
  const cam1Codes = [
    ...Array.from({ length: 14 }, (_, i) => `R005C${String(177 + i).padStart(7, "0")}`),
    "R005C0000195",
    "ZZZZZ0000001",
  ];
  const cam1Rows = cam1Codes.map((dataValue, i) => ({
    log_file_id: cam1File.id,
    log_file_header: "Camera 1 Log File",
    job_name: JOB_NAME,
    job_number: JOB_NUMBER,
    operator: "Garth",
    job_start_timestamp: JOB_START,
    job_end_timestamp: JOB_END,
    data_value: dataValue,
    data_timestamp: tsAt(i),
    sort_order: i + 1,
  }));
  const { error: cam1EntriesErr } = await admin.from("log_entries").insert(cam1Rows);
  if (cam1EntriesErr) throw new Error(`Failed to seed camera1 log_entries: ${cam1EntriesErr.message}`);

  // Camera2: 129,136,Bad_Read,146,Bad_Read,Bad_Read,163,170,175,180,184,189,194
  const cam2Values = [
    "R005C0000129", "R005C0000136", "Bad_Read", "R005C0000146", "Bad_Read", "Bad_Read",
    "R005C0000163", "R005C0000170", "R005C0000175", "R005C0000180", "R005C0000184",
    "R005C0000189", "R005C0000194",
  ];
  const cam2Rows = cam2Values.map((dataValue, i) => ({
    log_file_id: cam2File.id,
    log_file_header: "Camera 2 Log File",
    job_name: JOB_NAME,
    job_number: JOB_NUMBER,
    operator: "Garth",
    job_start_timestamp: JOB_START,
    job_end_timestamp: JOB_END,
    data_value: dataValue,
    data_timestamp: tsAt(300 + i),
    sort_order: i + 1,
  }));
  const { error: cam2EntriesErr } = await admin.from("log_entries").insert(cam2Rows);
  if (cam2EntriesErr) throw new Error(`Failed to seed camera2 log_entries: ${cam2EntriesErr.message}`);

  // --- Expected child -> parent mapping, per content/docs/data-correlation.md ---
  const expectedParent: Record<string, string | null> = {
    "R005C0000177": "R005C0000180",
    "R005C0000178": "R005C0000180",
    "R005C0000179": "R005C0000180",
    "R005C0000180": "R005C0000180",
    "R005C0000181": "R005C0000184",
    "R005C0000182": "R005C0000184",
    "R005C0000183": "R005C0000184",
    "R005C0000184": "R005C0000184",
    "R005C0000185": "R005C0000189",
    "R005C0000186": "R005C0000189",
    "R005C0000187": "R005C0000189",
    "R005C0000188": "R005C0000189",
    "R005C0000189": "R005C0000189",
    "R005C0000190": "R005C0000194",
    "R005C0000195": null,
    "ZZZZZ0000001": null,
  };

  // --- Step A: scheduled-style run (defaults) inserts everything fresh ---
  const { data: runId1, error: runErr1 } = await admin.rpc("run_log_correlation", {});
  if (runErr1) throw new Error(`run_log_correlation() failed: ${runErr1.message}`);

  const { data: rows1, error: fetchErr1 } = await admin
    .from("log_correlations")
    .select("*")
    .eq("job_name", JOB_NAME);
  if (fetchErr1) throw new Error(`Failed to fetch log_correlations: ${fetchErr1.message}`);

  assert(rows1?.length === cam1Codes.length, `expected ${cam1Codes.length} correlation rows, got ${rows1?.length}`);
  for (const row of rows1 ?? []) {
    assert(
      row.parent_code === expectedParent[row.child_code],
      `${row.child_code} -> parent_code expected ${expectedParent[row.child_code]}, got ${row.parent_code}`,
    );
  }

  const resolvedCustomerRows = (rows1 ?? []).filter((r) => r.child_code !== "ZZZZZ0000001");
  assert(
    resolvedCustomerRows.every((r) => r.customer_id === customer.id && r.customer_sequence_id === customerSequence.id),
    "all R005C-prefixed rows resolve to the seeded customer/customer_sequence",
  );
  const unmatchedRow = (rows1 ?? []).find((r) => r.child_code === "ZZZZZ0000001");
  assert(
    unmatchedRow?.customer_id === null && unmatchedRow?.customer_sequence_id === null,
    "ZZZZZ0000001 has no matching customer_sequence -> customer_id/customer_sequence_id null",
  );
  assert(runId1 != null, "run_log_correlation() returns a run id");

  // --- Step B: idempotency - rerun with no data changes, nothing should change ---
  const modifiedBefore = new Map((rows1 ?? []).map((r) => [r.child_log_entry_id, r.modified_timestamp]));
  const { error: runErr2 } = await admin.rpc("run_log_correlation", {});
  if (runErr2) throw new Error(`run_log_correlation() (rerun) failed: ${runErr2.message}`);

  const { data: rows2 } = await admin.from("log_correlations").select("*").eq("job_name", JOB_NAME);
  assert(rows2?.length === cam1Codes.length, "rerun with no new data does not create duplicate rows");
  assert(
    (rows2 ?? []).every((r) => modifiedBefore.get(r.child_log_entry_id) === r.modified_timestamp),
    "rerun with no new data does not touch modified_timestamp on any existing row (idempotent)",
  );

  // --- Step C: mutate reference data, confirm scheduled run still can't touch existing rows ---
  const { error: mutateErr } = await admin
    .from("customer_sequence")
    .update({ label_prefix: "NOPE_NO_MATCH" })
    .eq("id", customerSequence.id);
  if (mutateErr) throw new Error(`Failed to mutate customer_sequence: ${mutateErr.message}`);

  const { error: runErr3 } = await admin.rpc("run_log_correlation", {});
  if (runErr3) throw new Error(`run_log_correlation() (post-mutation, scheduled) failed: ${runErr3.message}`);

  const { data: rows3 } = await admin.from("log_correlations").select("*").eq("job_name", JOB_NAME);
  assert(
    resolvedCustomerRows.every((r) => {
      const current = (rows3 ?? []).find((x) => x.child_log_entry_id === r.child_log_entry_id);
      return current?.customer_id === customer.id;
    }),
    "scheduled run (default params) never revises an already-correlated row, even after reference data changes",
  );

  // --- Step D: manual reprocess run picks up the change ---
  const { data: runId4, error: runErr4 } = await admin.rpc("run_log_correlation", {
    p_allow_reprocess: true,
    p_triggered_by: "manual:test-log-correlation",
  });
  if (runErr4) throw new Error(`run_log_correlation() (manual reprocess) failed: ${runErr4.message}`);

  const { data: rows4 } = await admin.from("log_correlations").select("*").eq("job_name", JOB_NAME);
  assert(
    resolvedCustomerRows.every((r) => {
      const current = (rows4 ?? []).find((x) => x.child_log_entry_id === r.child_log_entry_id);
      return current?.customer_id === null && current?.customer_sequence_id === null && current?.modified_by === runId4;
    }),
    "manual reprocess (p_allow_reprocess: true) revises customer linkage after reference data changed, and stamps modified_by with the new run id",
  );

  const { data: run4Row, error: run4RowErr } = await admin
    .from("log_correlation_runs")
    .select("*")
    .eq("id", runId4)
    .single();
  if (run4RowErr) throw new Error(`Failed to fetch log_correlation_runs: ${run4RowErr.message}`);
  assert(run4Row.allow_reprocess === true, "log_correlation_runs records allow_reprocess for the manual run");
  assert(run4Row.triggered_by === "manual:test-log-correlation", "log_correlation_runs records triggered_by for the manual run");
  assert(
    run4Row.rows_updated === resolvedCustomerRows.length,
    `log_correlation_runs.rows_updated reflects the ${resolvedCustomerRows.length} revised rows`,
  );

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll run_log_correlation() tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
