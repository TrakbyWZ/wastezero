/**
 * Standalone test for run_log_correlation() / run_log_correlation_sweep()
 * (supabase/migrations/2026081612*). Connects directly to a real Postgres
 * instance (local or linked) via the admin client and RPC, since this
 * feature is pure SQL/plpgsql, not a TypeScript module.
 *
 * Local only - this suite seeds and deletes rows, and the customer_sequence it
 * creates takes part in resolving real codes while it exists. See
 * scripts/lib/require-local-supabase.ts.
 *
 * Usage:
 *   pnpm test:log-correlation -- --local
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createAdminClient } from "../lib/supabase/admin";
import {
  requireLocalFlag,
  assertLocalSupabaseUrl,
} from "./lib/require-local-supabase";

const TEST_CUSTOMER_NUM = "TESTLOGCORR";
const TEST_FILE_PREFIX = "test-log-correlation-";
/**
 * Label prefix for this test's seeded customer_sequence, and the prefix every
 * camera1 code below is built from. Deliberately not shaped like a real one.
 *
 * Customer resolution matches a code against *every* customer_sequence by
 * regex (customer_sequence_cam1_data_value_regex), not just the one this test
 * seeded, so the prefix has to be one no real sequence uses. It used to be
 * R005C, which is a live prefix belonging to customer EVERGREEN on a developer
 * database restored from production. Step A4 below renames this test's own
 * sequence away and asserts the rows stop resolving - but EVERGREEN's R005C
 * still matched them, so they kept resolving and that assertion failed for
 * reasons that had nothing to do with the code under test.
 *
 * assertPrefixIsUnused() re-checks this at startup rather than trusting it,
 * since a real sequence using this prefix could be added at any time.
 */
const TEST_LABEL_PREFIX = "ZQTST";
const TEST_NUMBER_FORMAT = "0000000";
/** Non-matching value step A4 renames the seeded sequence to. Namespaced so stray rows are traceable to this test. */
const TEST_RENAMED_LABEL_PREFIX = "ZQTST-RENAMED-NO-MATCH";
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
  requireLocalFlag("test:log-correlation");
  loadEnvFile(".env.local");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY in env.");
    process.exit(1);
  }
  assertLocalSupabaseUrl("test:log-correlation");

  const admin = createAdminClient();

  // --- Cleanup any previous run's data ---
  // Order matters, and errors are thrown rather than ignored: log_correlations
  // cascades from log_files but log_correlation_runs does not (its
  // child_log_file_id_param FK has no ON DELETE CASCADE), and
  // log_correlations.created_by/modified_by point back at those runs. Deleting
  // log_files alone fails on the second run with a foreign-key violation,
  // which then surfaces as a confusing duplicate-filename insert instead.
  const { data: staleFiles, error: staleFilesErr } = await admin
    .from("log_files")
    .select("id")
    .like("filename", `${TEST_FILE_PREFIX}%`);
  if (staleFilesErr) throw new Error(`Cleanup failed listing log_files: ${staleFilesErr.message}`);
  const staleFileIds = (staleFiles ?? []).map((f) => f.id as string);
  if (staleFileIds.length > 0) {
    const { error: delCorrErr } = await admin
      .from("log_correlations")
      .delete()
      .in("child_log_file_id", staleFileIds);
    if (delCorrErr) throw new Error(`Cleanup failed deleting log_correlations: ${delCorrErr.message}`);

    const { error: delRunsErr } = await admin
      .from("log_correlation_runs")
      .delete()
      .in("child_log_file_id_param", staleFileIds);
    if (delRunsErr) throw new Error(`Cleanup failed deleting log_correlation_runs: ${delRunsErr.message}`);

    const { error: delFilesErr } = await admin.from("log_files").delete().in("id", staleFileIds);
    if (delFilesErr) throw new Error(`Cleanup failed deleting log_files: ${delFilesErr.message}`);
  }

  const { error: delCustomerErr } = await admin
    .from("customer")
    .delete()
    .eq("customer_num", TEST_CUSTOMER_NUM);
  if (delCustomerErr) throw new Error(`Cleanup failed deleting test customer: ${delCustomerErr.message}`);

  // Customer resolution matches a code against every customer_sequence, not
  // just this test's, so any other sequence sharing TEST_LABEL_PREFIX silently
  // breaks the assertions about which sequence a row resolved to. Checked
  // after the cleanup above, so this test's own leftovers never trip it.
  const { data: collidingSequences, error: collisionErr } = await admin
    .from("customer_sequence")
    .select("id, label_prefix, number_format, customer_id")
    .eq("label_prefix", TEST_LABEL_PREFIX);
  if (collisionErr) throw new Error(`Failed to check for a colliding customer_sequence: ${collisionErr.message}`);
  if ((collidingSequences ?? []).length > 0) {
    throw new Error(
      `A customer_sequence already uses label_prefix "${TEST_LABEL_PREFIX}" ` +
        `(${(collidingSequences ?? []).map((s) => s.id).join(", ")}). ` +
        `This test's codes would resolve against it as well as the sequence it seeds, ` +
        `making the customer-resolution assertions meaningless. ` +
        `Change TEST_LABEL_PREFIX to a value no real customer_sequence uses.`,
    );
  }

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
      label_prefix: TEST_LABEL_PREFIX,
      number_format: TEST_NUMBER_FORMAT,
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
    ...Array.from({ length: 14 }, (_, i) => `${TEST_LABEL_PREFIX}${String(177 + i).padStart(7, "0")}`),
    "ZQTST0000195",
    // Deliberately matches no customer_sequence at all, seeded or real.
    "ZZZZZ0000001",
    "Bad_Read",
  ];

  await seedLogEntries(cam1FileA.id, "Camera 1 Log File", "EvergreenA", "EVG-A", cam1CodesA, 0);

  const cam2ValuesA = [
    "ZQTST0000129", "ZQTST0000136", "Bad_Read", "ZQTST0000146", "Bad_Read", "Bad_Read",
    "ZQTST0000163", "ZQTST0000170", "ZQTST0000175", "ZQTST0000180", "ZQTST0000184",
    "ZQTST0000189", "ZQTST0000194",
  ];
  // Most codes above are written out literally for readability, so they cannot
  // follow a change to TEST_LABEL_PREFIX on their own. Catch that drift here
  // rather than through a wall of confusing resolution failures. ZZZZZ is
  // exempt: it is the deliberately-unmatched prefix.
  const strayCode = [...cam1CodesA, ...cam2ValuesA].find(
    (code) => code !== "Bad_Read" && !code.startsWith(TEST_LABEL_PREFIX) && !code.startsWith("ZZZZZ"),
  );
  if (strayCode) {
    throw new Error(
      `Seeded code "${strayCode}" does not start with TEST_LABEL_PREFIX ("${TEST_LABEL_PREFIX}"). ` +
        `Update the literal codes in this file to match the constant.`,
    );
  }

  await seedLogEntries(cam2FileA.id, "Camera 2 Log File", "EvergreenA", "EVG-A", cam2ValuesA, 300);

  const expectedParentA: Record<string, string | null> = {
    "ZQTST0000177": "ZQTST0000180",
    "ZQTST0000178": "ZQTST0000180",
    "ZQTST0000179": "ZQTST0000180",
    "ZQTST0000180": "ZQTST0000180",
    "ZQTST0000181": "ZQTST0000184",
    "ZQTST0000182": "ZQTST0000184",
    "ZQTST0000183": "ZQTST0000184",
    "ZQTST0000184": "ZQTST0000184",
    "ZQTST0000185": "ZQTST0000189",
    "ZQTST0000186": "ZQTST0000189",
    "ZQTST0000187": "ZQTST0000189",
    "ZQTST0000188": "ZQTST0000189",
    "ZQTST0000189": "ZQTST0000189",
    "ZQTST0000190": "ZQTST0000194",
    "ZQTST0000195": null,
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
    "all ZQTST-prefixed rows resolve to the seeded customer/customer_sequence",
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
    .update({ label_prefix: TEST_RENAMED_LABEL_PREFIX })
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
