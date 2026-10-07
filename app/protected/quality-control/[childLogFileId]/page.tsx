"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PaginationControls } from "../_components/pagination-controls";
import { DEFAULT_PAGE_SIZE, type PageSizeOption } from "@/lib/constants/pagination";
import type { LogCorrelationFileRow, LogCorrelationRow, LogCorrelationRunRow } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

type StatusFilter = "all" | "unresolved" | "excluded" | "inferred";

type RowsResponse = {
  rows: LogCorrelationRow[];
  page: number;
  page_size: number;
  has_more: boolean;
  total_count: number | null;
  total_pages: number | null;
};

type EditState = {
  usr_child_code: string;
  usr_parent_code: string;
  usr_exclude_row: boolean;
  notes: string;
};

function editStateFromRow(row: LogCorrelationRow): EditState {
  return {
    usr_child_code: row.usr_child_code ?? "",
    usr_parent_code: row.usr_parent_code ?? "",
    usr_exclude_row: row.usr_exclude_row,
    notes: row.notes ?? "",
  };
}

export default function QualityControlDetailPage() {
  const params = useParams();
  const childLogFileId =
    typeof params.childLogFileId === "string" ? params.childLogFileId : null;

  const [rows, setRows] = useState<LogCorrelationRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");

  const [fileSummary, setFileSummary] = useState<LogCorrelationFileRow | null>(null);

  const [runs, setRuns] = useState<LogCorrelationRunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [triggering, setTriggering] = useState<"recorrelate" | "refill-gaps" | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const latestRun = runs[0] ?? null;
  const titleLabel = useMemo(
    () => latestRun?.id ?? fileSummary?.child_filename ?? childLogFileId ?? "",
    [latestRun, fileSummary, childLogFileId],
  );

  const fetchRows = useCallback(async () => {
    if (!childLogFileId) return;
    setRowsLoading(true);
    setRowsError(null);
    try {
      const params = new URLSearchParams({
        child_log_file_id: childLogFileId,
        page: String(page),
        page_size: String(pageSize),
      });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/log-correlations?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as RowsResponse;
      setRows(data.rows ?? []);
      setHasMore(data.has_more === true);
      setTotalCount(data.total_count ?? null);
      setTotalPages(data.total_pages ?? null);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : "Failed to load rows");
      setRows([]);
      setHasMore(false);
      setTotalCount(null);
      setTotalPages(null);
    } finally {
      setRowsLoading(false);
    }
  }, [childLogFileId, page, pageSize, status]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Header identity (filename/parent/customer/job) - fetched independently of
  // the row-status filter and run history, so it stays populated even when
  // the current filter matches zero rows or no runs exist yet.
  const fetchFileSummary = useCallback(async () => {
    if (!childLogFileId) return;
    try {
      const res = await fetch(`/api/log-correlation-files?child_log_file_id=${childLogFileId}`);
      if (!res.ok) throw new Error("Failed to load file summary");
      const data = await res.json();
      const row: LogCorrelationFileRow | undefined = (data.rows ?? [])[0];
      setFileSummary(row ?? null);
    } catch {
      setFileSummary(null);
    }
  }, [childLogFileId]);

  useEffect(() => {
    void fetchFileSummary();
  }, [fetchFileSummary]);

  const fetchRuns = useCallback(async () => {
    if (!childLogFileId) return;
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/log-correlation-runs?child_log_file_id=${childLogFileId}`);
      if (!res.ok) throw new Error("Failed to load run history");
      const data = await res.json();
      setRuns(data.rows ?? []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [childLogFileId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const trigger = useCallback(
    async (kind: "recorrelate" | "refill-gaps") => {
      if (!childLogFileId || triggering) return;
      setTriggering(kind);
      setTriggerError(null);
      try {
        const res = await fetch(`/api/log-files/${childLogFileId}/${kind}`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        await Promise.all([fetchRuns(), fetchRows()]);
      } catch (e) {
        setTriggerError(e instanceof Error ? e.message : `Failed to ${kind}`);
      } finally {
        setTriggering(null);
      }
    },
    [childLogFileId, triggering, fetchRuns, fetchRows],
  );

  const handlePageSizeChange = useCallback((size: PageSizeOption) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const startEdit = useCallback((row: LogCorrelationRow) => {
    setEditingId(row.id);
    setEditState(editStateFromRow(row));
    setSaveError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditState(null);
    setSaveError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !editState) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/log-correlations/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usr_child_code: editState.usr_child_code,
          usr_parent_code: editState.usr_parent_code,
          usr_exclude_row: editState.usr_exclude_row,
          notes: editState.notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Refetch (rather than patch the row in place) so a row that no
      // longer matches the active status filter - e.g. excluding it while
      // viewing "Unresolved" - correctly drops out of view immediately,
      // instead of lingering until the next unrelated refetch.
      setEditingId(null);
      setEditState(null);
      await fetchRows();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [editingId, editState, fetchRows]);

  if (!childLogFileId) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-6xl">
        <p className="text-destructive">Invalid file ID.</p>
        <Link href="/protected/quality-control">
          <Button variant="outline">Back to Quality Control</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2">
        <Link
          href="/protected/quality-control"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Quality Control
        </Link>
        <h1 className="text-2xl font-bold tracking-tight font-mono truncate">
          {latestRun ? <span className="font-sans font-normal text-muted-foreground mr-2">Run</span> : null}
          {titleLabel}
        </h1>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="text-muted-foreground/70">Child File: </span>
            <span className="font-mono">{fileSummary?.child_filename ?? "—"}</span>
          </span>
          <span>
            <span className="text-muted-foreground/70">Parent File: </span>
            <span className="font-mono">{fileSummary?.last_correlate_parent_filename ?? "—"}</span>
          </span>
          <span>
            <span className="text-muted-foreground/70">Customer: </span>
            {fileSummary?.customer_num ?? "—"}
          </span>
          <span>
            <span className="text-muted-foreground/70">Job: </span>
            {fileSummary?.job_name ?? "—"}
            {fileSummary?.job_number ? ` / ${fileSummary.job_number}` : ""}
          </span>
        </div>
      </div>

      {/* Run history */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-sm">Run history</h2>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={triggering !== null}
              onClick={() => trigger("recorrelate")}
            >
              {triggering === "recorrelate" ? "Re-correlating…" : "Re-correlate"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={triggering !== null}
              onClick={() => trigger("refill-gaps")}
            >
              {triggering === "refill-gaps" ? "Re-running…" : "Re-run gap-fill"}
            </Button>
          </div>
        </div>
        {triggerError && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm border-b">{triggerError}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-2">Started</th>
                <th className="text-left font-medium p-2">Operation</th>
                <th className="text-left font-medium p-2">Parent File</th>
                <th className="text-left font-medium p-2">Triggered By</th>
                <th className="text-left font-medium p-2">Status</th>
                <th className="text-left font-medium p-2">Inserted</th>
                <th className="text-left font-medium p-2">Updated</th>
                <th className="text-left font-medium p-2">Unresolved</th>
                <th className="text-left font-medium p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {runsLoading ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    No runs yet for this file.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id} className="border-b last:border-b-0 even:bg-muted/25">
                    <td className="p-2 text-muted-foreground">{formatDate(run.run_started_at)}</td>
                    <td className="p-2">{run.operation}</td>
                    <td
                      className="p-2 font-mono text-xs max-w-[180px] truncate text-muted-foreground"
                      title={run.resolved_parent_filename ?? ""}
                    >
                      {run.resolved_parent_filename ?? "—"}
                      {run.parent_log_file_id_param_filename && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          (override)
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-muted-foreground">{run.triggered_by}</td>
                    <td className="p-2">
                      <span className={run.status === "failed" ? "text-destructive font-medium" : ""}>
                        {run.status}
                      </span>
                    </td>
                    <td className="p-2">{run.rows_inserted}</td>
                    <td className="p-2">{run.rows_updated}</td>
                    <td className="p-2">{run.rows_unresolved}</td>
                    <td className="p-2 text-destructive text-xs max-w-[220px] truncate" title={run.error_message ?? ""}>
                      {run.error_message ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-3">
        <Label htmlFor="qc-status" className="text-sm">
          Filter
        </Label>
        <select
          id="qc-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="all">All rows</option>
          <option value="unresolved">Unresolved</option>
          <option value="excluded">Excluded</option>
          <option value="inferred">Inferred</option>
        </select>
      </div>

      {/* Row table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {rowsError && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">{rowsError}</div>
        )}
        {saveError && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">{saveError}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-2">Seq</th>
                <th className="text-left font-medium p-2">Child Code</th>
                <th className="text-left font-medium p-2">Parent Code</th>
                <th className="text-left font-medium p-2">Read At</th>
                <th className="text-left font-medium p-2">Inferred</th>
                <th className="text-left font-medium p-2">Excluded</th>
                <th className="text-left font-medium p-2">Notes</th>
                <th className="text-left font-medium p-2">Last Edited</th>
                <th className="sticky right-0 z-10 border-l bg-muted text-left font-medium p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rowsLoading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No rows match this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isEditing = editingId === row.id;
                  return (
                    <tr key={row.id} className="border-b last:border-b-0 even:bg-muted/25 align-top">
                      <td className="p-2 text-muted-foreground tabular-nums">
                        {row.child_sort_order ?? "—"}
                      </td>
                      {isEditing && editState ? (
                        <>
                          <td className="p-2">
                            <Input
                              value={editState.usr_child_code}
                              onChange={(e) =>
                                setEditState((s) => (s ? { ...s, usr_child_code: e.target.value } : s))
                              }
                              className="font-mono text-xs h-8"
                              placeholder={row.child_code ?? ""}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              value={editState.usr_parent_code}
                              onChange={(e) =>
                                setEditState((s) => (s ? { ...s, usr_parent_code: e.target.value } : s))
                              }
                              className="font-mono text-xs h-8"
                              placeholder={row.parent_code ?? ""}
                            />
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">
                            {formatDate(row.child_code_timestamp)}
                          </td>
                          <td className="p-2 text-muted-foreground">{row.is_inferred ? "Yes" : "No"}</td>
                          <td className="p-2">
                            <Checkbox
                              checked={editState.usr_exclude_row}
                              onCheckedChange={(checked) =>
                                setEditState((s) => (s ? { ...s, usr_exclude_row: checked === true } : s))
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Textarea
                              value={editState.notes}
                              onChange={(e) =>
                                setEditState((s) => (s ? { ...s, notes: e.target.value } : s))
                              }
                              className="text-xs min-h-[60px]"
                            />
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">
                            {row.overridden_by ? `${row.overridden_by} · ${formatDate(row.overridden_at)}` : "—"}
                          </td>
                          <td className="sticky right-0 border-l bg-card p-2">
                            <div className="flex flex-col gap-1">
                              <Button type="button" size="sm" disabled={saving} onClick={saveEdit}>
                                {saving ? "Saving…" : "Save"}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={cancelEdit}>
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-2 font-mono text-xs">
                            {row.effective_child_code ?? "—"}
                            {row.usr_child_code && (
                              <div className="text-muted-foreground line-through">{row.child_code ?? "—"}</div>
                            )}
                          </td>
                          <td className="p-2 font-mono text-xs">
                            {row.effective_parent_code ?? "—"}
                            {row.usr_parent_code && (
                              <div className="text-muted-foreground line-through">{row.parent_code ?? "—"}</div>
                            )}
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">
                            {formatDate(row.child_code_timestamp)}
                          </td>
                          <td className="p-2 text-muted-foreground">{row.is_inferred ? "Yes" : "No"}</td>
                          <td className="p-2">
                            {row.usr_exclude_row ? <span className="font-medium">Yes</span> : "No"}
                          </td>
                          <td className="p-2 text-muted-foreground text-xs max-w-[200px] truncate" title={row.notes ?? ""}>
                            {row.notes ?? "—"}
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">
                            {row.overridden_by ? `${row.overridden_by} · ${formatDate(row.overridden_at)}` : "—"}
                          </td>
                          <td className="sticky right-0 border-l bg-card p-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => startEdit(row)}>
                              Edit
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          hasMore={hasMore}
          loading={rowsLoading}
          itemCount={rows.length}
          itemLabel="row"
          totalCount={totalCount}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
