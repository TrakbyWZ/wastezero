/**
 * Standalone test for run_log_correlation() / run_log_correlation_sweep()
 * (supabase/migrations/2026081612*). Connects directly to a real Postgres
 * instance (local or linked) via the admin client and RPC, since this
 * feature is pure SQL/plpgsql, not a TypeScript module.
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

type SeededFile = { id: string };

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

  async function seedLogFile(filename: string): Promise<SeededFile> {
    const { data, error } = await admin
      .from("log_files")
      .insert({
        filename,
        upload_timestamp: JOB_START,
        total_reads: 0,
        bad_reads: 0,
        sequence_reads: 0,
        uploaded_by: "test-log-correlation",
        raw_content: "",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed log_files row ${filename}: ${error?.message}`);
    return data;
  }

  async function seedLogEntries(
    logFileId: string,
    header: "Camera 1 Log File" | "Camera 2 Log File",
    jobName: string,
    jobNumber: string,
    values: string[],
    startOffset: number,
  ) {
    const rows = values.map((dataValue, i) => ({
      log_file_id: logFileId,
      log_file_header: header,
      job_name: jobName,
      job_number: jobNumber,
      operator: "Garth",
      job_start_timestamp: JOB_START,
      job_end_timestamp: JOB_END,
      data_value: dataValue,
      data_timestamp: tsAt(startOffset + i),
      sort_order: i + 1,
    }));
    const { error } = await admin.from("log_entries").insert(rows);
    if (error) throw new Error(`Failed to seed ${header} entries for ${logFileId}: ${error.message}`);
  }

  /** log_correlations has no log_file_id column - resolve via child_log_entry_id -> log_entries.log_file_id. */
  async function fetchCorrelationsForFile(logFileId: string) {
    const { data: entries, error: entriesErr } = await admin
      .from("log_entries")
      .select("id")
      .eq("log_file_id", logFileId);
    if (entriesErr) throw new Error(`Failed to fetch log_entries for ${logFileId}: ${entriesErr.message}`);
    const ids = (entries ?? []).map((e) => e.id);
    if (ids.length === 0) return [];
    const { data, error } = await admin.from("log_correlations").select("*").in("child_log_entry_id", ids);
    if (error) throw new Error(`Failed to fetch log_correlations for ${logFileId}: ${error.message}`);
    return data ?? [];
  }

  async function countCorrelations(): Promise<number> {
    const { count, error } = await admin.from("log_correlations").select("id", { count: "exact", head: true });
    if (error) throw new Error(`Failed to count log_correlations: ${error.message}`);
    return count ?? 0;
  }

  // ==========================================================================
  // Job A: the content/docs/data-correlation.md sample. Used for the ceiling-
  // match algorithm, customer resolution, idempotency, and the default/
  // manual-reprocess boundary.
  // ==========================================================================
  const customerRes = await admin
    .from("customer")
    .insert({ customer_num: TEST_CUSTOMER_NUM, customer_description: "Log correlation test customer" })
    .select("id")
    .single();
  if (customerRes.error || !customerRes.data) throw new Error(`Failed to seed customer: ${customerRes.error?.message}`);
  const customer = customerRes.data;

  const customerSequenceRes = await admin
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
  if (customerSequenceRes.error || !customerSequenceRes.data) {
    throw new Error(`Failed to seed customer_sequence: ${customerSequenceRes.error?.message}`);
  }
  const customerSequence = customerSequenceRes.data;

  const cam1FileA = await seedLogFile(`${TEST_FILE_PREFIX}cam1a.txt`);
  const cam2FileA = await seedLogFile(`${TEST_FILE_PREFIX}cam2a.txt`);

  const cam1CodesA = [
    ...Array.from({ length: 14 }, (_, i) => `R005C${String(177 + i).padStart(7, "0")}`),
    "R005C0000195",
    "ZZZZZ0000001",
    "Bad_Read",
  ];
  await seedLogEntries(cam1FileA.id, "Camera 1 Log File", "EvergreenA", "EVG-A", cam1CodesA, 0);

  const cam2ValuesA = [
    "R005C0000129", "R005C0000136", "Bad_Read", "R005C0000146", "Bad_Read", "Bad_Read",
    "R005C0000163", "R005C0000170", "R005C0000175", "R005C0000180", "R005C0000184",
    "R005C0000189", "R005C0000194",
  ];
  await seedLogEntries(cam2FileA.id, "Camera 2 Log File", "EvergreenA", "EVG-A", cam2ValuesA, 300);

  const expectedParentA: Record<string, string | null> = {
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
    "Bad_Read": null,
  };

  // Step A1: auto-resolve the parent file from job identity (no override).
  const { data: runIdA1, error: runErrA1 } = await admin.rpc("run_log_correlation", {
    p_child_log_file_id: cam1FileA.id,
  });
  if (runErrA1) throw new Error(`run_log_correlation() (job A) failed: ${runErrA1.message}`);

  const rowsA = await fetchCorrelationsForFile(cam1FileA.id);
  assert(rowsA.length === cam1CodesA.length, `expected ${cam1CodesA.length} correlation rows for job A, got ${rowsA.length}`);
  for (const row of rowsA) {
    assert(
      row.parent_code === expectedParentA[row.child_code],
      `${row.child_code} -> parent_code expected ${expectedParentA[row.child_code]}, got ${row.parent_code}`,
    );
  }

  const resolvedCustomerRowsA = rowsA.filter((r) => r.child_code !== "ZZZZZ0000001" && r.child_code !== "Bad_Read");
  assert(
    resolvedCustomerRowsA.every((r) => r.customer_id === customer.id && r.customer_sequence_id === customerSequence.id),
    "all R005C-prefixed rows resolve to the seeded customer/customer_sequence",
  );
  const unmatchedRowA = rowsA.find((r) => r.child_code === "ZZZZZ0000001");
  assert(
    unmatchedRowA?.customer_id === null && unmatchedRowA?.customer_sequence_id === null,
    "ZZZZZ0000001 has no matching customer_sequence -> customer_id/customer_sequence_id null",
  );
  const badReadRowA = rowsA.find((r) => r.child_code === "Bad_Read");
  assert(
    badReadRowA !== undefined,
    "a Bad_Read camera1 row still gets a log_correlations row (visible as attempted-but-unresolved, not silently missing)",
  );
  assert(
    badReadRowA?.parent_code === null && badReadRowA?.customer_id === null && badReadRowA?.customer_sequence_id === null,
    "a Bad_Read camera1 row resolves to fully unresolved (parent and customer both null), with no special-casing needed",
  );
  assert(runIdA1 != null, "run_log_correlation() returns a run id");

  const { data: runRowA1, error: runRowA1Err } = await admin
    .from("log_correlation_runs")
    .select("resolved_parent_log_file_id, parent_log_file_id_param")
    .eq("id", runIdA1)
    .single();
  if (runRowA1Err) throw new Error(`Failed to fetch log_correlation_runs for job A: ${runRowA1Err.message}`);
  assert(
    runRowA1?.resolved_parent_log_file_id === cam2FileA.id,
    "log_correlation_runs.resolved_parent_log_file_id records the auto-resolved parent file",
  );
  assert(runRowA1?.parent_log_file_id_param === null, "parent_log_file_id_param is null when no override was passed");

  // Step A2: idempotency - rerun with no data changes, nothing should change.
  const modifiedBeforeA = new Map(rowsA.map((r) => [r.child_log_entry_id, r.modified_timestamp]));
  const { error: runErrA2 } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileA.id });
  if (runErrA2) throw new Error(`run_log_correlation() (job A rerun) failed: ${runErrA2.message}`);

  const rowsA2 = await fetchCorrelationsForFile(cam1FileA.id);
  assert(rowsA2.length === cam1CodesA.length, "rerun with no new data does not create duplicate rows");
  assert(
    rowsA2.every((r) => modifiedBeforeA.get(r.child_log_entry_id) === r.modified_timestamp),
    "rerun with no new data does not touch modified_timestamp on any existing row (idempotent)",
  );

  // Step A3: mutate reference data, confirm the default (allow_reprocess=false)
  // call still can't touch existing rows.
  const { error: mutateErr } = await admin
    .from("customer_sequence")
    .update({ label_prefix: "NOPE_NO_MATCH" })
    .eq("id", customerSequence.id);
  if (mutateErr) throw new Error(`Failed to mutate customer_sequence: ${mutateErr.message}`);

  const { error: runErrA3 } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileA.id });
  if (runErrA3) throw new Error(`run_log_correlation() (job A post-mutation) failed: ${runErrA3.message}`);

  const rowsA3 = await fetchCorrelationsForFile(cam1FileA.id);
  assert(
    resolvedCustomerRowsA.every((r) => {
      const current = rowsA3.find((x) => x.child_log_entry_id === r.child_log_entry_id);
      return current?.customer_id === customer.id;
    }),
    "default call (p_allow_reprocess=false) never revises an already-correlated row, even after reference data changes",
  );

  // Step A4: manual reprocess picks up the change.
  const { data: runIdA4, error: runErrA4 } = await admin.rpc("run_log_correlation", {
    p_child_log_file_id: cam1FileA.id,
    p_allow_reprocess: true,
    p_triggered_by: "manual:test-log-correlation",
  });
  if (runErrA4) throw new Error(`run_log_correlation() (job A manual reprocess) failed: ${runErrA4.message}`);

  const rowsA4 = await fetchCorrelationsForFile(cam1FileA.id);
  assert(
    resolvedCustomerRowsA.every((r) => {
      const current = rowsA4.find((x) => x.child_log_entry_id === r.child_log_entry_id);
      return current?.customer_id === null && current?.customer_sequence_id === null && current?.modified_by === runIdA4;
    }),
    "manual reprocess (p_allow_reprocess: true) revises customer linkage after reference data changed, and stamps modified_by with the new run id",
  );

  const { data: runRowA4, error: runRowA4Err } = await admin
    .from("log_correlation_runs")
    .select("*")
    .eq("id", runIdA4)
    .single();
  if (runRowA4Err) throw new Error(`Failed to fetch log_correlation_runs: ${runRowA4Err.message}`);
  assert(runRowA4.allow_reprocess === true, "log_correlation_runs records allow_reprocess for the manual run");
  assert(runRowA4.triggered_by === "manual:test-log-correlation", "log_correlation_runs records triggered_by for the manual run");
  assert(
    runRowA4.rows_updated === resolvedCustomerRowsA.length,
    `log_correlation_runs.rows_updated reflects the ${resolvedCustomerRowsA.length} revised rows`,
  );

  // ==========================================================================
  // Job B: child/parent files whose job identity deliberately doesn't match
  // (auto-resolve finds zero candidates -> "not ready"), used to prove the
  // p_parent_log_file_id override bypasses job matching entirely.
  // ==========================================================================
  const cam1FileB = await seedLogFile(`${TEST_FILE_PREFIX}cam1b.txt`);
  const cam2FileB = await seedLogFile(`${TEST_FILE_PREFIX}cam2b.txt`);
  await seedLogEntries(cam1FileB.id, "Camera 1 Log File", "EvergreenB", "EVG-B", ["R777C0000010"], 0);
  await seedLogEntries(cam2FileB.id, "Camera 2 Log File", "EvergreenB-mismatch", "EVG-B-mismatch", ["R777C0000015"], 0);

  const { data: runIdB1, error: runErrB1 } = await admin.rpc("run_log_correlation", {
    p_child_log_file_id: cam1FileB.id,
  });
  if (runErrB1) throw new Error(`run_log_correlation() (job B, no override) failed: ${runErrB1.message}`);
  const { data: runRowB1 } = await admin
    .from("log_correlation_runs")
    .select("resolved_parent_log_file_id, status, rows_inserted")
    .eq("id", runIdB1)
    .single();
  assert(
    runRowB1?.resolved_parent_log_file_id === null && runRowB1?.status === "succeeded" && runRowB1?.rows_inserted === 0,
    "mismatched job identity with no override -> not ready, succeeds with 0 rows",
  );

  const { data: runIdB2, error: runErrB2 } = await admin.rpc("run_log_correlation", {
    p_child_log_file_id: cam1FileB.id,
    p_parent_log_file_id: cam2FileB.id,
  });
  if (runErrB2) throw new Error(`run_log_correlation() (job B, override) failed: ${runErrB2.message}`);
  const rowsB = await fetchCorrelationsForFile(cam1FileB.id);
  assert(
    rowsB.length === 1 && rowsB[0]?.parent_code === "R777C0000015",
    "p_parent_log_file_id override correlates against the specified parent file despite mismatched job identity",
  );
  const { data: runRowB2 } = await admin
    .from("log_correlation_runs")
    .select("resolved_parent_log_file_id, parent_log_file_id_param")
    .eq("id", runIdB2)
    .single();
  assert(
    runRowB2?.resolved_parent_log_file_id === cam2FileB.id && runRowB2?.parent_log_file_id_param === cam2FileB.id,
    "log_correlation_runs records both the override param and the resolved parent file id",
  );

  // ==========================================================================
  // Job C: two camera2 files matching the same job identity -> ambiguous,
  // must raise rather than silently pick one.
  // ==========================================================================
  const cam1FileC = await seedLogFile(`${TEST_FILE_PREFIX}cam1c.txt`);
  const cam2FileC1 = await seedLogFile(`${TEST_FILE_PREFIX}cam2c1.txt`);
  const cam2FileC2 = await seedLogFile(`${TEST_FILE_PREFIX}cam2c2.txt`);
  await seedLogEntries(cam1FileC.id, "Camera 1 Log File", "EvergreenC", "EVG-C", ["R888C0000010"], 0);
  await seedLogEntries(cam2FileC1.id, "Camera 2 Log File", "EvergreenC", "EVG-C", ["R888C0000015"], 0);
  await seedLogEntries(cam2FileC2.id, "Camera 2 Log File", "EvergreenC", "EVG-C", ["R888C0000020"], 0);

  const { data: runIdC, error: runErrC } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileC.id });
  if (runErrC) throw new Error(`run_log_correlation() (job C) failed unexpectedly at the RPC layer: ${runErrC.message}`);
  const { data: runRowC, error: runRowCErr } = await admin
    .from("log_correlation_runs")
    .select("status, error_message")
    .eq("id", runIdC)
    .single();
  if (runRowCErr) throw new Error(`Failed to fetch log_correlation_runs for job C: ${runRowCErr.message}`);
  assert(
    runRowC?.status === "failed" && !!runRowC?.error_message?.match(/Ambiguous/i),
    "ambiguous parent (two camera2 files matching the same job identity) is recorded as a failed run with an 'Ambiguous parent file' error, without throwing at the RPC layer",
  );

  // ==========================================================================
  // Job D: never manually correlated - used to prove run_log_correlation_sweep()
  // discovers and processes ready-but-pending files on its own.
  // ==========================================================================
  const cam1FileD = await seedLogFile(`${TEST_FILE_PREFIX}cam1d.txt`);
  const cam2FileD = await seedLogFile(`${TEST_FILE_PREFIX}cam2d.txt`);
  await seedLogEntries(cam1FileD.id, "Camera 1 Log File", "EvergreenD", "EVG-D", ["R999C0000010"], 0);
  await seedLogEntries(cam2FileD.id, "Camera 2 Log File", "EvergreenD", "EVG-D", ["R999C0000015"], 0);

  const { error: sweepErr1 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErr1) throw new Error(`run_log_correlation_sweep() failed: ${sweepErr1.message}`);

  const rowsD = await fetchCorrelationsForFile(cam1FileD.id);
  assert(
    rowsD.length === 1 && rowsD[0]?.parent_code === "R999C0000015",
    "run_log_correlation_sweep() discovers and correlates a ready-but-never-processed file on its own",
  );

  // Job C's file has no correlation rows (it keeps failing ambiguously), and
  // job A/B are already fully correlated -> rerunning the sweep should be a
  // no-op (0 new correlation rows), and should not throw despite job C still
  // being unresolvable.
  const countBeforeResweep = await countCorrelations();
  const { error: sweepErr2 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErr2) throw new Error(`run_log_correlation_sweep() (rerun) failed: ${sweepErr2.message}`);
  const countAfterResweep = await countCorrelations();
  assert(
    countBeforeResweep === countAfterResweep,
    "rerunning the sweep with nothing new pending does not error and does not add rows, despite job C remaining unresolvable",
  );

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll run_log_correlation() / run_log_correlation_sweep() tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
