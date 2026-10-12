/**
 * Standalone test for fill_log_correlation_gaps()
 * (supabase/migrations/20261005120200_create_fill_log_correlation_gaps.sql).
 * Connects directly to a real Postgres instance (local or linked) via the
 * admin client and RPC, since this feature is pure SQL/plpgsql, not a
 * TypeScript module. Follows the same pattern as
 * scripts/test-log-correlation.ts.
 *
 * Usage:
 *   pnpm test:log-correlation-gaps -- --local
 *   pnpm test:log-correlation-gaps -- --linked
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createAdminClient } from "../lib/supabase/admin";

const TEST_FILE_PREFIX = "test-log-correlation-gaps-";
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

  async function seedLogFile(filename: string): Promise<SeededFile> {
    const { data, error } = await admin
      .from("log_files")
      .insert({
        filename,
        upload_timestamp: JOB_START,
        total_reads: 0,
        bad_reads: 0,
        sequence_reads: 0,
        uploaded_by: "test-log-correlation-gaps",
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

  async function fetchCorrelationsForFile(childLogFileId: string) {
    const { data, error } = await admin
      .from("log_correlations")
      .select("*")
      .eq("child_log_file_id", childLogFileId)
      .order("usr_child_code", { ascending: true });
    if (error) throw new Error(`Failed to fetch log_correlations for ${childLogFileId}: ${error.message}`);
    return data ?? [];
  }

  function byEffectiveCode(rows: Record<string, unknown>[]) {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const code = (r.usr_child_code as string | null) ?? (r.child_code as string | null);
      if (code) map.set(code, r);
    }
    return map;
  }

  // ==========================================================================
  // Job A: a single file exercising every gap shape in one pass:
  //   177 (real) -> 178 Bad_Read (type A, 1-wide) -> 179 (real)
  //   179 (real) -> [nothing] -> 181 (real)                 (type B, 1-wide)
  //   181 (real) -> Bad_Read, Bad_Read -> 184 (real)         (type A, 2-wide)
  //   184 (real) -> [nothing] -> 187 (real)                 (type B, 2-wide)
  //   187 (real) -> Bad_Read -> [nothing] -> 190 (real)      (ambiguous: 1
  //     placeholder present but 2 missing - must be skipped entirely)
  //   190 (real) -> Bad_Read -> 992 (real)                   (too wide: 801
  //     missing, over the small p_max_gap_span used below - must be skipped)
  //   leading Bad_Read before the first real row, trailing Bad_Read after
  //     the last real row - both must be skipped (no bound on one side).
  // ==========================================================================
  const cam1FileA = await seedLogFile(`${TEST_FILE_PREFIX}cam1a.txt`);
  const cam2FileA = await seedLogFile(`${TEST_FILE_PREFIX}cam2a.txt`);

  const cam1CodesA = [
    "Bad_Read", // leading placeholder - no left bound, must be skipped
    "R005C0000177",
    "Bad_Read", // -> 178, type A (1-wide)
    "R005C0000179",
    // gap: nothing for 180 - type B (1-wide)
    "R005C0000181",
    "Bad_Read", // -> 182
    "Bad_Read", // -> 183, type A (2-wide)
    "R005C0000184",
    // gap: nothing for 185, 186 - type B (2-wide)
    "R005C0000187",
    "Bad_Read", // ambiguous: only 1 placeholder but 2 missing (188, 189)
    // gap: nothing for the other missing number
    "R005C0000190",
    "Bad_Read", // gap to 992 is 801-wide - too wide for p_max_gap_span=100 below
    "R005C0000992",
    "Bad_Read", // trailing placeholder - no right bound, must be skipped
  ];
  await seedLogEntries(cam1FileA.id, "Camera 1 Log File", "GapTestA", "GAP-A", cam1CodesA, 0);

  // Parent file: ceiling-matches exist for every number from 177 through 992,
  // so every filled/inferred child code in job A has a real usr_parent_code.
  const cam2ValuesA = Array.from({ length: 820 }, (_, i) => `R005C${String(177 + i).padStart(7, "0")}`);
  await seedLogEntries(cam2FileA.id, "Camera 2 Log File", "GapTestA", "GAP-A", cam2ValuesA, 2000);

  const { error: runErrA } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileA.id });
  if (runErrA) throw new Error(`run_log_correlation() (job A) failed: ${runErrA.message}`);

  const rowsABeforeFill = await fetchCorrelationsForFile(cam1FileA.id);
  assert(rowsABeforeFill.length === cam1CodesA.length, `expected ${cam1CodesA.length} rows before gap-fill, got ${rowsABeforeFill.length}`);

  const { data: fillRunIdA, error: fillErrA } = await admin.rpc("fill_log_correlation_gaps", {
    p_child_log_file_id: cam1FileA.id,
    p_max_gap_span: 100,
  });
  if (fillErrA) throw new Error(`fill_log_correlation_gaps() (job A) failed: ${fillErrA.message}`);
  assert(fillRunIdA != null, "fill_log_correlation_gaps() returns a run id");

  const rowsA = await fetchCorrelationsForFile(cam1FileA.id);
  const byCodeA = byEffectiveCode(rowsA as Record<string, unknown>[]);

  // --- Type A (1-wide): Bad_Read between 177 and 179 becomes 178 ---
  const row178 = byCodeA.get("R005C0000178");
  assert(!!row178, "type A (1-wide): a usr_child_code of 178 now exists");
  assert(row178?.is_inferred === false, "178 is a corrected real row (Bad_Read), not an inferred one");
  assert(row178?.usr_parent_code === "R005C0000178", "178's usr_parent_code ceiling-matches against the parent file");
  assert(row178?.overridden_by === "gap-fill", "178's overridden_by records the gap-fill run");
  assert(row178?.overridden_at != null, "178's overridden_at is set");

  // --- Type B (1-wide): no row at all for 180 - inferred row inserted ---
  const row180 = byCodeA.get("R005C0000180");
  assert(!!row180, "type B (1-wide): an inferred row for 180 now exists");
  assert(row180?.is_inferred === true, "180 is a synthetic inferred row (no backing log_entries row)");
  assert(row180?.child_log_entry_id === null, "180's child_log_entry_id is null (no backing entry)");
  assert(row180?.usr_parent_code === "R005C0000180", "180's usr_parent_code ceiling-matches against the parent file");
  assert(row180?.job_name === "GapTestA" && row180?.job_number === "GAP-A", "180 carries forward the file's job identity");

  // --- Type A (2-wide): two Bad_Read rows between 181 and 184 become 182, 183 ---
  const row182 = byCodeA.get("R005C0000182");
  const row183 = byCodeA.get("R005C0000183");
  assert(!!row182 && !!row183, "type A (2-wide): usr_child_codes of 182 and 183 now exist");
  assert(row182?.is_inferred === false && row183?.is_inferred === false, "182/183 are corrected real rows, not inferred");

  // --- Type B (2-wide): no rows at all for 185, 186 - two inferred rows inserted ---
  const row185 = byCodeA.get("R005C0000185");
  const row186 = byCodeA.get("R005C0000186");
  assert(!!row185 && !!row186, "type B (2-wide): inferred rows for 185 and 186 now exist");
  assert(row185?.is_inferred === true && row186?.is_inferred === true, "185/186 are synthetic inferred rows");

  // --- Ambiguous (1 placeholder present, 2 missing): must be skipped entirely ---
  assert(!byCodeA.has("R005C0000188") && !byCodeA.has("R005C0000189"), "ambiguous gap (187->190, 1 placeholder but 2 missing) is skipped - no 188 or 189 row created");
  const unresolvedCountInGap = rowsA.filter(
    (r) => (r as Record<string, unknown>).usr_child_code === null && (r as Record<string, unknown>).child_code === "Bad_Read",
  );
  assert(
    unresolvedCountInGap.length === 4,
    `exactly 4 Bad_Read rows remain unfilled: leading, the ambiguous gap's placeholder, the too-wide gap's placeholder, and trailing - got ${unresolvedCountInGap.length}`,
  );

  // --- Too wide (190 -> 992, 801 missing, over p_max_gap_span=100): skipped ---
  assert(!byCodeA.has("R005C0000199") && !byCodeA.has("R005C0000500"), "a gap wider than p_max_gap_span is skipped entirely - no inferred rows anywhere in its span");

  // --- Leading/trailing placeholders: no bound on one side, must stay unfilled ---
  const leadingRow = rowsA.find((r) => (r as Record<string, unknown>).child_log_entry_id !== null && (r as Record<string, unknown>).child_code === "Bad_Read" && (r as Record<string, unknown>).usr_child_code === null);
  assert(!!leadingRow, "at least one Bad_Read row (leading or trailing) remains unfilled, since it has no bound on one side");

  const { data: fillRunRowA, error: fillRunRowAErr } = await admin
    .from("log_correlation_runs")
    .select("operation, rows_inserted, rows_updated, rows_unresolved, status, resolved_parent_log_file_id, parent_log_file_id_param")
    .eq("id", fillRunIdA)
    .single();
  if (fillRunRowAErr) throw new Error(`Failed to fetch log_correlation_runs for job A fill: ${fillRunRowAErr.message}`);
  assert(fillRunRowA?.operation === "gap_fill", "the fill run's log_correlation_runs row is tagged operation = 'gap_fill'");
  assert(fillRunRowA?.status === "succeeded", "the fill run succeeded");
  assert(fillRunRowA?.rows_inserted === 3, `rows_inserted counts the 3 inferred rows (180, 185, 186) - got ${fillRunRowA?.rows_inserted}`);
  assert(fillRunRowA?.rows_updated === 3, `rows_updated counts the 3 in-place corrections (178, 182, 183) - got ${fillRunRowA?.rows_updated}`);
  assert(fillRunRowA?.rows_unresolved === 2, `rows_unresolved counts exactly the ambiguous gap and the too-wide gap as skipped - got ${fillRunRowA?.rows_unresolved}`);
  assert(
    fillRunRowA?.resolved_parent_log_file_id === cam2FileA.id,
    "gap-fill runs record the parent file they found (via an already-resolved row), same column run_log_correlation() uses",
  );
  assert(fillRunRowA?.parent_log_file_id_param === null, "gap-fill runs do not take a parent file override");

  // --- Idempotency: rerunning with no data changes should not add/change anything ---
  const countBefore = rowsA.length;
  const modifiedBefore = new Map(rowsA.map((r) => [(r as Record<string, unknown>).id, (r as Record<string, unknown>).modified_timestamp]));
  const { error: refillErrA } = await admin.rpc("fill_log_correlation_gaps", {
    p_child_log_file_id: cam1FileA.id,
    p_max_gap_span: 100,
  });
  if (refillErrA) throw new Error(`fill_log_correlation_gaps() (job A rerun) failed: ${refillErrA.message}`);
  const rowsAAfterRerun = await fetchCorrelationsForFile(cam1FileA.id);
  assert(rowsAAfterRerun.length === countBefore, "rerunning gap-fill with nothing new does not insert duplicate inferred rows");
  assert(
    rowsAAfterRerun.every((r) => modifiedBefore.get((r as Record<string, unknown>).id) === (r as Record<string, unknown>).modified_timestamp),
    "rerunning gap-fill does not touch modified_timestamp on any already-filled row (idempotent)",
  );

  // ==========================================================================
  // Job B: a human-made correction must never be clobbered by a later
  // gap-fill run, by default (p_allow_refill = false).
  // ==========================================================================
  const cam1FileB = await seedLogFile(`${TEST_FILE_PREFIX}cam1b.txt`);
  const cam2FileB = await seedLogFile(`${TEST_FILE_PREFIX}cam2b.txt`);
  await seedLogEntries(
    cam1FileB.id,
    "Camera 1 Log File",
    "GapTestB",
    "GAP-B",
    ["R005C0000300", "Bad_Read", "R005C0000302"],
    0,
  );
  await seedLogEntries(
    cam2FileB.id,
    "Camera 2 Log File",
    "GapTestB",
    "GAP-B",
    ["R005C0000300", "R005C0000301", "R005C0000302"],
    100,
  );
  const { error: runErrB } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileB.id });
  if (runErrB) throw new Error(`run_log_correlation() (job B) failed: ${runErrB.message}`);

  const rowsBBefore = await fetchCorrelationsForFile(cam1FileB.id);
  const placeholderRowB = rowsBBefore.find((r) => (r as Record<string, unknown>).child_code === "Bad_Read");
  if (!placeholderRowB) throw new Error("expected a Bad_Read placeholder row for job B");

  // A human corrects the row by hand (to the same value gap-fill would have
  // inferred, 301 - the point is that the row was already touched by a
  // human, not that the value differs) before gap-fill ever runs, simulating
  // "QC already reviewed this row". A default (p_allow_refill = false) run
  // must leave it completely alone: same value, same overridden_by/at, and
  // critically no new rows anywhere in the file as a side effect.
  const humanOverriddenAt = new Date().toISOString();
  const { error: humanUpdateErr } = await admin
    .from("log_correlations")
    .update({ usr_child_code: "R005C0000301", overridden_by: "qc-human@example.com", overridden_at: humanOverriddenAt })
    .eq("id", (placeholderRowB as Record<string, unknown>).id);
  if (humanUpdateErr) throw new Error(`Failed to seed human correction: ${humanUpdateErr.message}`);

  const { error: fillErrB } = await admin.rpc("fill_log_correlation_gaps", { p_child_log_file_id: cam1FileB.id });
  if (fillErrB) throw new Error(`fill_log_correlation_gaps() (job B) failed: ${fillErrB.message}`);

  const rowsBAfter = await fetchCorrelationsForFile(cam1FileB.id);
  assert(rowsBAfter.length === 3, "a default gap-fill run creates no new rows in a file that is already fully human-reviewed");

  const { data: refetchedRowB, error: refetchErrB } = await admin
    .from("log_correlations")
    .select("usr_child_code, overridden_by, overridden_at")
    .eq("id", (placeholderRowB as Record<string, unknown>).id)
    .single();
  if (refetchErrB) throw new Error(`Failed to refetch job B row: ${refetchErrB.message}`);
  assert(refetchedRowB?.usr_child_code === "R005C0000301", "a human correction (overridden_by set to a human identity) is never overwritten by a default gap-fill run");
  assert(refetchedRowB?.overridden_by === "qc-human@example.com", "the human's overridden_by value is preserved, not replaced with 'gap-fill'");
  assert(
    refetchedRowB?.overridden_at != null && new Date(refetchedRowB.overridden_at as string).getTime() === new Date(humanOverriddenAt).getTime(),
    "the human's overridden_at timestamp is preserved - the row was never touched again",
  );

  // ==========================================================================
  // Job C: excluded placeholder rows (usr_exclude_row = true) must never be
  // auto-filled, even when they would otherwise close an unambiguous gap.
  // ==========================================================================
  const cam1FileC = await seedLogFile(`${TEST_FILE_PREFIX}cam1c.txt`);
  const cam2FileC = await seedLogFile(`${TEST_FILE_PREFIX}cam2c.txt`);
  await seedLogEntries(
    cam1FileC.id,
    "Camera 1 Log File",
    "GapTestC",
    "GAP-C",
    ["R005C0000400", "Bad_Read", "R005C0000402"],
    0,
  );
  await seedLogEntries(
    cam2FileC.id,
    "Camera 2 Log File",
    "GapTestC",
    "GAP-C",
    ["R005C0000400", "R005C0000401", "R005C0000402"],
    100,
  );
  const { error: runErrC } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileC.id });
  if (runErrC) throw new Error(`run_log_correlation() (job C) failed: ${runErrC.message}`);

  const rowsCBefore = await fetchCorrelationsForFile(cam1FileC.id);
  const excludedRowC = rowsCBefore.find((r) => (r as Record<string, unknown>).child_code === "Bad_Read");
  if (!excludedRowC) throw new Error("expected a Bad_Read placeholder row for job C");
  const { error: excludeErr } = await admin
    .from("log_correlations")
    .update({ usr_exclude_row: true })
    .eq("id", (excludedRowC as Record<string, unknown>).id);
  if (excludeErr) throw new Error(`Failed to seed exclusion: ${excludeErr.message}`);

  const { error: fillErrC } = await admin.rpc("fill_log_correlation_gaps", { p_child_log_file_id: cam1FileC.id });
  if (fillErrC) throw new Error(`fill_log_correlation_gaps() (job C) failed: ${fillErrC.message}`);

  const rowsCAfter = await fetchCorrelationsForFile(cam1FileC.id);
  assert(rowsCAfter.length === 3, "no inferred row is inserted for an excluded gap (the excluded row still physically occupies that slot)");
  const { data: refetchedRowC, error: refetchErrC } = await admin
    .from("log_correlations")
    .select("usr_child_code, usr_exclude_row")
    .eq("id", (excludedRowC as Record<string, unknown>).id)
    .single();
  if (refetchErrC) throw new Error(`Failed to refetch job C row: ${refetchErrC.message}`);
  assert(refetchedRowC?.usr_child_code === null, "an excluded placeholder row is never auto-filled");
  assert(refetchedRowC?.usr_exclude_row === true, "the exclusion flag is left untouched");

  // ==========================================================================
  // Job D: prefix change between two consecutive known rows - never bridged.
  // ==========================================================================
  const cam1FileD = await seedLogFile(`${TEST_FILE_PREFIX}cam1d.txt`);
  await seedLogEntries(
    cam1FileD.id,
    "Camera 1 Log File",
    "GapTestD",
    "GAP-D",
    ["R005C0000500", "Bad_Read", "ZZZZZ0000501"],
    0,
  );
  // No parent file for job D - run_log_correlation() will succeed with "not
  // ready" (0 rows), so seed log_correlations rows directly isn't possible
  // via that path. Use p_parent_log_file_id override against itself's own
  // camera1 file is invalid; instead seed a trivial camera2 file so
  // correlation proceeds and rows exist for gap-fill to walk.
  const cam2FileD = await seedLogFile(`${TEST_FILE_PREFIX}cam2d.txt`);
  await seedLogEntries(cam2FileD.id, "Camera 2 Log File", "GapTestD", "GAP-D", ["R005C0000500"], 100);
  const { error: runErrD } = await admin.rpc("run_log_correlation", { p_child_log_file_id: cam1FileD.id });
  if (runErrD) throw new Error(`run_log_correlation() (job D) failed: ${runErrD.message}`);

  const { error: fillErrD } = await admin.rpc("fill_log_correlation_gaps", { p_child_log_file_id: cam1FileD.id });
  if (fillErrD) throw new Error(`fill_log_correlation_gaps() (job D) failed: ${fillErrD.message}`);

  const rowsD = await fetchCorrelationsForFile(cam1FileD.id);
  assert(rowsD.length === 3, "a prefix change is never bridged - no inferred/corrected row is added between R005C and ZZZZZ");
  const unresolvedD = rowsD.find((r) => (r as Record<string, unknown>).child_code === "Bad_Read");
  assert(unresolvedD !== undefined && (unresolvedD as Record<string, unknown>).usr_child_code === null, "the Bad_Read row between two different prefixes remains unfilled");

  // ==========================================================================
  // Job E: proves run_log_correlation_sweep() wiring - a file that has
  // never had fill_log_correlation_gaps() called on it directly should
  // still get its gap filled by the sweep itself, in the same call that
  // discovers and correlates it (its two loops run sequentially within one
  // function invocation).
  // ==========================================================================
  const cam1FileE = await seedLogFile(`${TEST_FILE_PREFIX}cam1e.txt`);
  const cam2FileE = await seedLogFile(`${TEST_FILE_PREFIX}cam2e.txt`);
  await seedLogEntries(
    cam1FileE.id,
    "Camera 1 Log File",
    "GapTestE",
    "GAP-E",
    ["R005C0000700", "Bad_Read", "R005C0000702"],
    0,
  );
  await seedLogEntries(
    cam2FileE.id,
    "Camera 2 Log File",
    "GapTestE",
    "GAP-E",
    ["R005C0000700", "R005C0000701", "R005C0000702"],
    100,
  );

  // First sweep tick: run_log_correlation_sweep() discovers and correlates
  // the new file in its first loop, then its second loop finds the
  // just-created placeholder row already eligible (same function call, same
  // transaction) and gap-fills it too - both in one tick, no direct
  // fill_log_correlation_gaps() call needed.
  const { error: sweepErr1 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErr1) throw new Error(`run_log_correlation_sweep() (job E, tick 1) failed: ${sweepErr1.message}`);

  const rowsEAfterTick1 = await fetchCorrelationsForFile(cam1FileE.id);
  assert(rowsEAfterTick1.length === 3, "sweep tick 1 correlates job E's file");
  const filledE = rowsEAfterTick1.find((r) => (r as Record<string, unknown>).usr_child_code === "R005C0000701");
  assert(!!filledE, "the same sweep tick also gap-fills job E's file on its own, with no direct fill_log_correlation_gaps() call");
  assert((filledE as Record<string, unknown>).overridden_by === "gap-fill", "the sweep-driven fill is attributed to 'gap-fill'");

  const { data: sweepGapFillRuns, error: sweepGapFillRunsErr } = await admin
    .from("log_correlation_runs")
    .select("id, resolved_parent_log_file_id")
    .eq("child_log_file_id_param", cam1FileE.id)
    .eq("operation", "gap_fill");
  if (sweepGapFillRunsErr) throw new Error(`Failed to fetch gap_fill runs for job E: ${sweepGapFillRunsErr.message}`);
  assert((sweepGapFillRuns ?? []).length === 1, "the sweep recorded exactly one gap_fill audit run for job E");
  assert(
    sweepGapFillRuns?.[0]?.resolved_parent_log_file_id === cam2FileE.id,
    "the sweep-driven gap_fill run also records its resolved parent file",
  );

  // A second tick should find nothing left pending for this file (the
  // partial index's eligibility predicate no longer matches it) and not
  // call fill_log_correlation_gaps() again.
  const { error: sweepErr2 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErr2) throw new Error(`run_log_correlation_sweep() (job E, tick 2) failed: ${sweepErr2.message}`);
  const { data: sweepGapFillRunsAfterTick2, error: sweepGapFillRunsAfterTick2Err } = await admin
    .from("log_correlation_runs")
    .select("id")
    .eq("child_log_file_id_param", cam1FileE.id)
    .eq("operation", "gap_fill");
  if (sweepGapFillRunsAfterTick2Err) {
    throw new Error(`Failed to fetch gap_fill runs for job E after tick 2: ${sweepGapFillRunsAfterTick2Err.message}`);
  }
  assert(
    (sweepGapFillRunsAfterTick2 ?? []).length === 1,
    "once a file has no pending placeholder rows left, the sweep stops calling fill_log_correlation_gaps() for it",
  );

  // ==========================================================================
  // Job F: proves the sweep's stuck-file throttle - a file whose only gap
  // can never be resolved automatically (a leading placeholder, no left
  // bound) should get exactly one gap_fill run from repeated sweep ticks,
  // not one per tick forever, but a change to the file (simulating a future
  // manual correction) should make it eligible again.
  // ==========================================================================
  const cam1FileF = await seedLogFile(`${TEST_FILE_PREFIX}cam1f.txt`);
  const cam2FileF = await seedLogFile(`${TEST_FILE_PREFIX}cam2f.txt`);
  await seedLogEntries(
    cam1FileF.id,
    "Camera 1 Log File",
    "GapTestF",
    "GAP-F",
    ["Bad_Read", "R005C0000800", "R005C0000801"],
    0,
  );
  await seedLogEntries(
    cam2FileF.id,
    "Camera 2 Log File",
    "GapTestF",
    "GAP-F",
    ["R005C0000800", "R005C0000801"],
    100,
  );

  async function countGapFillRuns(childLogFileId: string): Promise<number> {
    const { data, error } = await admin
      .from("log_correlation_runs")
      .select("id")
      .eq("child_log_file_id_param", childLogFileId)
      .eq("operation", "gap_fill");
    if (error) throw new Error(`Failed to count gap_fill runs for ${childLogFileId}: ${error.message}`);
    return (data ?? []).length;
  }

  // Tick 1: correlates the file (first loop) and attempts gap-fill (second
  // loop) - the leading Bad_Read has no left bound, so this attempt is a
  // complete no-op (0 inserted, 0 updated), but it's still the first-ever
  // attempt so it must run.
  const { error: sweepErrF1 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErrF1) throw new Error(`run_log_correlation_sweep() (job F, tick 1) failed: ${sweepErrF1.message}`);
  assert((await countGapFillRuns(cam1FileF.id)).valueOf() === 1, "tick 1 makes exactly one gap_fill attempt for job F's file");

  const { data: firstRunRowF, error: firstRunRowFErr } = await admin
    .from("log_correlation_runs")
    .select("rows_inserted, rows_updated")
    .eq("child_log_file_id_param", cam1FileF.id)
    .eq("operation", "gap_fill")
    .single();
  if (firstRunRowFErr) throw new Error(`Failed to fetch job F's first gap_fill run: ${firstRunRowFErr.message}`);
  assert(
    firstRunRowF?.rows_inserted === 0 && firstRunRowF?.rows_updated === 0,
    "job F's first gap_fill attempt makes zero progress, as expected for a leading (unbound) placeholder",
  );

  // Ticks 2 and 3: nothing has changed since tick 1's no-op run - the
  // throttle must stop the sweep from calling fill_log_correlation_gaps()
  // for this file again.
  const { error: sweepErrF2 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErrF2) throw new Error(`run_log_correlation_sweep() (job F, tick 2) failed: ${sweepErrF2.message}`);
  const { error: sweepErrF3 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErrF3) throw new Error(`run_log_correlation_sweep() (job F, tick 3) failed: ${sweepErrF3.message}`);
  assert(
    (await countGapFillRuns(cam1FileF.id)) === 1,
    "ticks 2 and 3 add no further gap_fill runs for job F - the file is permanently stuck and nothing has changed",
  );

  // Simulate a future manual touch (e.g. a QC correction once a review UI
  // exists) by bumping modified_timestamp on the file's placeholder row.
  // The next tick should treat the file as eligible again.
  const rowsFBeforeTouch = await fetchCorrelationsForFile(cam1FileF.id);
  const leadingRowF = rowsFBeforeTouch.find((r) => (r as Record<string, unknown>).child_code === "Bad_Read");
  if (!leadingRowF) throw new Error("expected a leading Bad_Read row for job F");
  const { error: touchErr } = await admin
    .from("log_correlations")
    .update({ notes: "reviewed by QC (simulated)", modified_timestamp: new Date().toISOString() })
    .eq("id", (leadingRowF as Record<string, unknown>).id);
  if (touchErr) throw new Error(`Failed to simulate a manual touch for job F: ${touchErr.message}`);

  const { error: sweepErrF4 } = await admin.rpc("run_log_correlation_sweep", {});
  if (sweepErrF4) throw new Error(`run_log_correlation_sweep() (job F, tick 4) failed: ${sweepErrF4.message}`);
  assert(
    (await countGapFillRuns(cam1FileF.id)) === 2,
    "a change to the file's rows since the last gap_fill run makes it eligible for the sweep again",
  );

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll fill_log_correlation_gaps() tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
