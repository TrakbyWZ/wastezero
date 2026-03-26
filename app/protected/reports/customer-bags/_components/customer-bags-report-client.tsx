"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type PageSizeOption,
} from "@/lib/constants/pagination";
import type { CustomerBagsXrefRow } from "@/app/api/reports/customer-bags/route";
import type { CustomerRow, CustomerSequenceRow } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

const reportColumns: Array<{
  key: string;
  label: string;
  className?: string;
  render: (row: CustomerBagsXrefRow) => React.ReactNode;
}> = [
  {
    key: "customer_id",
    label: "Customer ID",
    className: "font-mono text-xs",
    render: (row) =>
      row.customer_id ? (
        <Link
          href={`/protected/customers/${row.customer_id}`}
          className="text-primary hover:underline"
        >
          …{row.customer_id.slice(-6)}
        </Link>
      ) : (
        "—"
      ),
  },
  {
    key: "customer_num",
    label: "Customer Num",
    className: "font-mono text-xs",
    render: (row) => row.customer_num ?? "—",
  },
  {
    key: "customer_description",
    label: "Customer Description",
    className: "text-muted-foreground",
    render: (row) => row.customer_description ?? "—",
  },
  {
    key: "label_prefix",
    label: "Label Prefix",
    className: "font-mono text-xs",
    render: (row) => row.label_prefix ?? "—",
  },
  {
    key: "customer_sequence_id",
    label: "Customer Sequence ID",
    className: "font-mono text-xs",
    render: (row) =>
      row.customer_sequence_id ? `…${row.customer_sequence_id.slice(-6)}` : "—",
  },
  {
    key: "cam1_log_file_id",
    label: "Log File ID",
    className: "font-mono text-xs",
    render: (row) => `…${row.cam1_log_file_id.slice(-8)}`,
  },
  {
    key: "cam1_filename",
    label: "Filename",
    className: "text-muted-foreground",
    render: (row) => row.cam1_filename ?? "—",
  },
  {
    key: "cam1_upload_timestamp",
    label: "Upload Timestamp",
    className: "text-muted-foreground",
    render: (row) => formatDate(row.cam1_upload_timestamp),
  },
  {
    key: "cam1_job_start_timestamp",
    label: "Job Start Timestamp",
    className: "text-muted-foreground",
    render: (row) => formatDate(row.cam1_job_start_timestamp),
  },
  {
    key: "cam1_job_end_timestamp",
    label: "Job End Timestamp",
    className: "text-muted-foreground",
    render: (row) => formatDate(row.cam1_job_end_timestamp),
  },
  {
    key: "data_value",
    label: "Parent Camera Data Value",
    className: "font-mono text-xs",
    render: (row) => row.data_value ?? "—",
  },
  {
    key: "data_timestamp",
    label: "Parent Camera Data Timestamp",
    className: "text-muted-foreground",
    render: (row) => formatDate(row.data_timestamp),
  },
  {
    key: "cam1_data_value",
    label: "Child Camera Data Value",
    className: "font-mono text-xs",
    render: (row) => row.cam1_data_value ?? "—",
  },
  {
    key: "cam1_data_timestamp",
    label: "Child Camera Data Timestamp",
    className: "text-muted-foreground",
    render: (row) => formatDate(row.cam1_data_timestamp),
  },
];

type ReportFilters = {
  customerId: string;
  fromDate: string;
  toDate: string;
  labelPrefix: string;
  filename: string;
};

export default function CustomerBagsReportClient() {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [labelPrefix, setLabelPrefix] = useState("");
  const [filename, setFilename] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>({
    customerId: "",
    fromDate: "",
    toDate: "",
    labelPrefix: "",
    filename: "",
  });
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerSequences, setCustomerSequences] = useState<CustomerSequenceRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingCustomerSequences, setLoadingCustomerSequences] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [rows, setRows] = useState<CustomerBagsXrefRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshingReport, setRefreshingReport] = useState(false);
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const refreshInProgressRef = useRef(false);

  const selectedCustomer = customerId
    ? customers.find((c) => c.id === customerId) ?? null
    : null;

  const fetchCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const res = await fetch("/api/customers?active_only=true");
      if (!res.ok) throw new Error("Failed to load customers");
      const data = await res.json();
      setCustomers(data.customers ?? []);
    } catch {
      setCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  const fetchCustomerSequences = useCallback(async (nextCustomerId: string) => {
    if (!nextCustomerId) {
      setCustomerSequences([]);
      return;
    }

    setLoadingCustomerSequences(true);
    try {
      const params = new URLSearchParams({ customer: nextCustomerId });
      const res = await fetch(`/api/customer-sequences?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load customer sequences");
      const data = await res.json();
      const sequences = (data.sequences ?? []) as CustomerSequenceRow[];
      setCustomerSequences(
        sequences.filter(
          (sequence, index, all) =>
            sequence.label_prefix != null &&
            sequence.label_prefix.trim() !== "" &&
            all.findIndex(
              (candidate) => candidate.label_prefix === sequence.label_prefix,
            ) === index,
        ),
      );
    } catch {
      setCustomerSequences([]);
    } finally {
      setLoadingCustomerSequences(false);
    }
  }, []);

  const fetchReport = useCallback(async (
    filters: ReportFilters,
    cursor: string | null,
    pageSize: number,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.customerId) params.set("customer", filters.customerId);
      if (filters.fromDate) params.set("from", filters.fromDate);
      if (filters.toDate) params.set("to", filters.toDate);
      if (filters.labelPrefix) params.set("label_prefix", filters.labelPrefix);
      if (filters.filename) params.set("filename", filters.filename);
      params.set("page_size", String(pageSize));
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/reports/customer-bags?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRows(data.rows ?? []);
      setNextCursor(typeof data.next_cursor === "string" ? data.next_cursor : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
      setRows([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const runReport = useCallback(async () => {
    if (!customerId || !fromDate || !toDate) {
      setError("Customer, from date, and to date are required.");
      setHasRun(false);
      setRows([]);
      setNextCursor(null);
      return;
    }

    if (fromDate > toDate) {
      setError("From date must be before or equal to to date.");
      setHasRun(false);
      setRows([]);
      setNextCursor(null);
      return;
    }

    const nextFilters = {
      customerId,
      fromDate,
      toDate,
      labelPrefix: labelPrefix.trim(),
      filename: filename.trim(),
    };
    setAppliedFilters(nextFilters);
    setPageCursors([null]);
    setPageIndex(0);
    setHasRun(true);
    await fetchReport(nextFilters, null, pageSize);
  }, [customerId, filename, fromDate, labelPrefix, fetchReport, pageSize, toDate]);

  const exportReport = useCallback(async () => {
    if (!customerId || !fromDate || !toDate) {
      setError("Customer, from date, and to date are required.");
      return;
    }

    if (fromDate > toDate) {
      setError("From date must be before or equal to to date.");
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        customer: customerId,
        from: fromDate,
        to: toDate,
      });
      if (labelPrefix.trim()) params.set("label_prefix", labelPrefix.trim());
      if (filename.trim()) params.set("filename", filename.trim());

      const res = await fetch(`/api/reports/customer-bags/download?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        res.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ??
        "customer-bags.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export report");
    } finally {
      setExporting(false);
    }
  }, [customerId, filename, fromDate, labelPrefix, toDate]);

  const refreshReportData = useCallback(async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    setRefreshingReport(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/customer-bags/refresh", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to run full refresh");
      }
      if (hasRun && appliedFilters.customerId && appliedFilters.fromDate && appliedFilters.toDate) {
        await fetchReport(appliedFilters, pageCursors[pageIndex] ?? null, pageSize);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run full refresh");
    } finally {
      refreshInProgressRef.current = false;
      setRefreshingReport(false);
    }
  }, [appliedFilters, fetchReport, hasRun, pageCursors, pageIndex, pageSize]);

  const openRefreshConfirm = useCallback(() => {
    if (refreshingReport) return;
    setRefreshConfirmOpen(true);
  }, [refreshingReport]);

  const closeRefreshConfirm = useCallback(() => {
    if (!refreshingReport) setRefreshConfirmOpen(false);
  }, [refreshingReport]);

  const confirmRefreshReportData = useCallback(() => {
    setRefreshConfirmOpen(false);
    void refreshReportData();
  }, [refreshReportData]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    if (!customerId) {
      setCustomerSequences([]);
      setLabelPrefix("");
      return;
    }

    setLabelPrefix("");
    void fetchCustomerSequences(customerId);
  }, [customerId, fetchCustomerSequences]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const filteredCustomers = customerSearch
    ? customers.filter((c) => {
        const lower = customerSearch.toLowerCase();
        const num = (c.customer_num ?? "").toLowerCase();
        const desc = (c.customer_description ?? "").toLowerCase();
        return num.includes(lower) || desc.includes(lower);
      })
    : customers;

  const clearFilters = useCallback(() => {
    setCustomerId("");
    setCustomerSearch("");
    setFromDate("");
    setToDate("");
    setLabelPrefix("");
    setFilename("");
    setAppliedFilters({
      customerId: "",
      fromDate: "",
      toDate: "",
      labelPrefix: "",
      filename: "",
    });
    setRows([]);
    setNextCursor(null);
    setPageCursors([null]);
    setPageIndex(0);
    setHasRun(false);
    setError(null);
  }, []);

  const currentPage = pageIndex + 1;

  const goToPreviousPage = useCallback(async () => {
    if (!hasRun || loading || pageIndex <= 0) return;
    const previousIndex = pageIndex - 1;
    const previousCursor = pageCursors[previousIndex] ?? null;
    setPageIndex(previousIndex);
    await fetchReport(appliedFilters, previousCursor, pageSize);
  }, [appliedFilters, fetchReport, hasRun, loading, pageCursors, pageIndex, pageSize]);

  const goToNextPage = useCallback(async () => {
    if (!hasRun || loading || !nextCursor) return;
    const nextIndex = pageIndex + 1;
    setPageCursors((current) => {
      const updated = current.slice(0, nextIndex);
      updated[nextIndex] = nextCursor;
      return updated;
    });
    setPageIndex(nextIndex);
    await fetchReport(appliedFilters, nextCursor, pageSize);
  }, [appliedFilters, fetchReport, hasRun, loading, nextCursor, pageIndex, pageSize]);

  const changePageSize = useCallback(
    async (nextPageSize: PageSizeOption) => {
      setPageSize(nextPageSize);
      setPageCursors([null]);
      setPageIndex(0);
      if (!hasRun) return;
      await fetchReport(appliedFilters, null, nextPageSize);
    },
    [appliedFilters, fetchReport, hasRun],
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customer Bags</h1>
        <p className="text-muted-foreground text-sm">
          Report based on customer sequence xref. Customer and date range are required; you can also filter by label prefix and filename.
        </p>
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
          <div className="space-y-2" ref={customerDropdownRef}>
            <Label htmlFor="report-customer">Customer *</Label>
            <Input
              id="report-customer"
              type="text"
              value={selectedCustomer ? `${selectedCustomer.customer_num}${selectedCustomer.customer_description ? ` — ${selectedCustomer.customer_description}` : ""}` : customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                if (selectedCustomer) setCustomerId("");
                setCustomerDropdownOpen(true);
              }}
              onFocus={() => setCustomerDropdownOpen(true)}
              placeholder="Search customer..."
              required
              autoComplete="off"
              className="w-full"
            />
            {customerDropdownOpen && (
              <div className="border rounded-md bg-popover shadow-md max-h-48 overflow-auto mt-1">
                {loadingCustomers ? (
                  <div className="p-3 text-sm text-muted-foreground">Loading…</div>
                ) : filteredCustomers.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No customers match.</div>
                ) : (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                      onClick={() => {
                        setCustomerId(c.id);
                        setCustomerSearch("");
                        setCustomerDropdownOpen(false);
                      }}
                    >
                      <span className="font-mono">{c.customer_num}</span>
                      {c.customer_description ? (
                        <span className="text-muted-foreground ml-2">— {c.customer_description}</span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-label-prefix">Label Prefix</Label>
            <select
              id="report-label-prefix"
              value={labelPrefix}
              onChange={(e) => setLabelPrefix(e.target.value)}
              disabled={!customerId || loadingCustomerSequences}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {!customerId
                  ? "Select a Customer First"
                  : loadingCustomerSequences
                    ? "Loading Label Prefixes..."
                    : "All Label Prefixes"}
              </option>
              {customerSequences.map((sequence) => (
                <option key={sequence.id} value={sequence.label_prefix ?? ""}>
                  {sequence.label_prefix ?? "—"}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 xl:col-span-1">
            <Label htmlFor="report-from">From Date *</Label>
            <Input
              id="report-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div className="space-y-2 xl:col-span-1">
            <Label htmlFor="report-to">To Date *</Label>
            <Input
              id="report-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
              className="w-full"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="report-filename">Filename</Label>
            <Input
              id="report-filename"
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Search filename..."
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
            <Button
              type="button"
              variant="default"
              onClick={runReport}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? "Running…" : "Run Report"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={exportReport}
              disabled={exporting}
              className="w-full sm:w-auto"
            >
              {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={clearFilters}
              className="w-full sm:w-auto"
            >
              Clear Filters
            </Button>
          </div>
          <div className="hidden md:block" aria-hidden="true" />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              onClick={openRefreshConfirm}
              disabled={refreshingReport}
              className="w-full sm:w-auto"
              title="Rebuild report table from log data (full refresh — use only when report is empty or out of date)"
            >
              {refreshingReport ? "Refreshing…" : "Full Refresh Report"}
            </Button>
          </div>
        </div>
      </div>

      {/* Refresh report confirmation modal */}
      {refreshConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeRefreshConfirm()}
          onKeyDown={(e) => e.key === "Escape" && closeRefreshConfirm()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="refresh-report-confirm-title"
        >
          <Card className="w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="space-y-0 pb-2">
              <CardTitle id="refresh-report-confirm-title">Full refresh report?</CardTitle>
              <CardDescription className="pt-2">
                This will rebuild the entire Customer Bags report table from log data. The process
                can take a long time depending on how much data you have. You may leave this page
                while it runs; the refresh will continue in the background. Do not start another
                refresh until this one finishes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={closeRefreshConfirm}>
                Cancel
              </Button>
              <Button type="button" variant="default" onClick={confirmRefreshReportData}>
                Yes, full refresh report
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-3 border-b bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>
            {loading
              ? "Loading…"
              : hasRun
                ? `${rows.length} row${rows.length === 1 ? "" : "s"} on page ${currentPage}`
                : "Select a customer, choose a date range, and click Run Report"}
          </div>
          <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Label htmlFor="report-page-size">Rows per page</Label>
              <select
                id="report-page-size"
                value={pageSize}
                onChange={(e) =>
                  changePageSize(Number(e.target.value) as PageSizeOption)
                }
                className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                Page {hasRun ? currentPage : 1}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void goToPreviousPage()}
                disabled={!hasRun || loading || pageIndex <= 0}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void goToNextPage()}
                disabled={!hasRun || loading || !nextCursor}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
                {reportColumns.map((column) => (
                  <th key={column.key} className="text-left font-medium p-3">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={reportColumns.length} className="p-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={reportColumns.length} className="p-8 text-center text-muted-foreground">
                    {hasRun
                      ? "No rows match the current filters. Adjust filters or date range."
                      : "Select a customer, choose a date range, and click Run Report to see results."}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={`${row.cam1_log_file_id}-${row.cam1_data_value ?? ""}-${idx}`}
                    className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors"
                  >
                    {reportColumns.map((column) => (
                      <td key={column.key} className={`p-3 ${column.className ?? ""}`}>
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
