"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import type { CustomerRow, LogCorrelationFileRow } from "@/lib/types";

function RunStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const className =
    status === "failed"
      ? "text-destructive font-medium"
      : status === "succeeded"
        ? "text-green-700 dark:text-green-400"
        : "text-muted-foreground";
  return <span className={className}>{status}</span>;
}

type FilesResponse = {
  rows: LogCorrelationFileRow[];
  page: number;
  page_size: number;
  has_more: boolean;
};

export default function QualityControlListPage() {
  const [files, setFiles] = useState<LogCorrelationFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [customersForDropdown, setCustomersForDropdown] = useState<CustomerRow[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [jobName, setJobName] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [needsAttention, setNeedsAttention] = useState(false);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/customers?active_only=true");
      if (!res.ok) throw new Error("Failed to load customers");
      const data = await res.json();
      const rows: CustomerRow[] = data.customers ?? [];
      rows.sort((a, b) =>
        a.customer_num.localeCompare(b.customer_num, undefined, { numeric: true, sensitivity: "base" }),
      );
      setCustomersForDropdown(rows);
    } catch {
      setCustomersForDropdown([]);
    }
  }, []);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(DEFAULT_PAGE_SIZE),
      });
      if (customerId) params.set("customer_id", customerId);
      if (jobName.trim()) params.set("job_name", jobName.trim());
      if (jobNumber.trim()) params.set("job_number", jobNumber.trim());
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (needsAttention) params.set("needs_attention", "true");

      const res = await fetch(`/api/log-correlation-files?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as FilesResponse;
      setFiles(data.rows ?? []);
      setHasMore(data.has_more === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
      setFiles([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [page, customerId, jobName, jobNumber, fromDate, toDate, needsAttention]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const clearFilters = useCallback(() => {
    setCustomerId("");
    setJobName("");
    setJobNumber("");
    setFromDate("");
    setToDate("");
    setNeedsAttention(false);
    setPage(1);
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Quality Control</h1>
        <p className="text-muted-foreground text-sm">
          Find a camera1/camera2 log file to review its correlation data, run history, and fix rows the
          algorithm couldn&apos;t resolve.
        </p>
      </div>

      {/* Filter bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="qc-customer">Customer</Label>
            <select
              id="qc-customer"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All customers</option>
              {customersForDropdown.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customer_num}
                  {c.customer_description ? ` — ${c.customer_description}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-job-name">Job name</Label>
            <Input
              id="qc-job-name"
              value={jobName}
              onChange={(e) => {
                setJobName(e.target.value);
                setPage(1);
              }}
              className="w-full"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-job-number">Job number</Label>
            <Input
              id="qc-job-number"
              value={jobNumber}
              onChange={(e) => {
                setJobNumber(e.target.value);
                setPage(1);
              }}
              className="w-full"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2 h-9">
            <Checkbox
              id="qc-needs-attention"
              checked={needsAttention}
              onCheckedChange={(checked) => {
                setNeedsAttention(checked === true);
                setPage(1);
              }}
            />
            <Label htmlFor="qc-needs-attention" className="cursor-pointer">
              Needs attention only
            </Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-from">From date</Label>
            <Input
              id="qc-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-to">To date</Label>
            <Input
              id="qc-to"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="w-full"
            />
          </div>
          <Button type="button" variant="outline" onClick={clearFilters} className="w-full md:w-auto">
            Clear filters
          </Button>
        </div>
      </div>

      {/* File list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">{error}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-3">Filename</th>
                <th className="text-left font-medium p-3">Job</th>
                <th className="text-left font-medium p-3">Customer</th>
                <th className="text-left font-medium p-3">Date</th>
                <th className="text-left font-medium p-3">Rows</th>
                <th className="text-left font-medium p-3">Unresolved</th>
                <th className="text-left font-medium p-3">Excluded</th>
                <th className="text-left font-medium p-3">Last Correlate</th>
                <th className="text-left font-medium p-3">Last Gap-Fill</th>
                <th className="text-left font-medium p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : files.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    No files match the current filters.
                  </td>
                </tr>
              ) : (
                files.map((row) => (
                  <tr
                    key={row.child_log_file_id}
                    className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-3 font-mono text-xs max-w-[180px] truncate" title={row.child_filename}>
                      {row.child_filename}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.job_name ?? "—"}
                      {row.job_number ? ` / ${row.job_number}` : ""}
                    </td>
                    <td className="p-3 text-muted-foreground">{row.customer_num ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{row.job_date}</td>
                    <td className="p-3">{row.total_count.toLocaleString()}</td>
                    <td className="p-3">
                      <span className={row.unresolved_count > 0 ? "text-destructive font-medium" : ""}>
                        {row.unresolved_count.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={row.excluded_count > 0 ? "font-medium" : ""}>
                        {row.excluded_count.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-3">
                      <RunStatusBadge status={row.last_correlate_run_status} />
                    </td>
                    <td className="p-3">
                      <RunStatusBadge status={row.last_gap_fill_run_status} />
                    </td>
                    <td className="p-3">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <Link href={`/protected/quality-control/${row.child_log_file_id}`}>Review</Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>{loading ? "Loading…" : `${files.length} file${files.length === 1 ? "" : "s"} on page ${page}`}</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Page {page}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
