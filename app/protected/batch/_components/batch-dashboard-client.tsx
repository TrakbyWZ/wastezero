"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, Copy } from "lucide-react";
import {
  computeEndFromStartOffsetCount,
  computeStartFromLastEnd,
  padSequenceNumber,
} from "@/lib/sequence";
import type { BatchRow, CustomerRow } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function truncateFilename(name: string | null, maxLen: number = 28): string {
  if (!name) return "—";
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + "…";
}

export default function BatchDashboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customer") ?? "";
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [customersForDropdown, setCustomersForDropdown] = useState<CustomerRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [copiedFilenameId, setCopiedFilenameId] = useState<string | null>(null);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const [lastBatchForCustomer, setLastBatchForCustomer] = useState<BatchRow | null>(null);
  const [loadingLastBatch, setLoadingLastBatch] = useState(false);
  const [customerSequenceOffset, setCustomerSequenceOffset] = useState<number | null>(null);
  const [customerSequenceLabelPrefix, setCustomerSequenceLabelPrefix] = useState<string | null>(null);
  const [customerSequenceNumberFormat, setCustomerSequenceNumberFormat] = useState<string | null>(null);
  const [loadingCustomerSequence, setLoadingCustomerSequence] = useState(false);
  const [form, setForm] = useState({
    customer_id: "",
    customer_search: "",
    initial_start_sequence: "1",
    sequence_count: "",
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (customerId) params.set("customer", customerId);
      const res = await fetch(`/api/batches?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setBatches(data.batches ?? []);
      setTotalCount(typeof data.total_count === "number" ? data.total_count : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load batches");
      setBatches([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, from, to, customerId]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const clearFilters = useCallback(() => {
    setQ("");
    setFrom("");
    setTo("");
    setDebouncedQ("");
    if (customerId) {
      router.replace("/protected/batch");
    }
  }, [customerId, router]);

  const fetchCustomersForDropdown = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const res = await fetch("/api/customers?active_only=true");
      if (!res.ok) throw new Error("Failed to load customers");
      const data = await res.json();
      setCustomersForDropdown(data.customers ?? []);
    } catch {
      setCustomersForDropdown([]);
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  const fetchLastBatchForCustomer = useCallback(async (cid: string) => {
    setLoadingLastBatch(true);
    try {
      const res = await fetch(`/api/batches?customer=${encodeURIComponent(cid)}`);
      if (!res.ok) throw new Error("Failed to load batches");
      const data = await res.json();
      const batchesList = data.batches ?? [];
      const last = batchesList[0] ?? null;
      setLastBatchForCustomer(last);
      if (!last) {
        setForm((f) => ({ ...f, initial_start_sequence: "1" }));
      }
    } catch {
      setLastBatchForCustomer(null);
    } finally {
      setLoadingLastBatch(false);
    }
  }, []);

  const fetchCustomerSequence = useCallback(async (cid: string) => {
    setLoadingCustomerSequence(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(cid)}/sequence`);
      if (!res.ok) throw new Error("Failed to load sequence");
      const data = await res.json();
      setCustomerSequenceOffset(data.offset_sequence ?? null);
      setCustomerSequenceLabelPrefix(data.label_prefix ?? null);
      setCustomerSequenceNumberFormat(data.number_format ?? null);
    } catch {
      setCustomerSequenceOffset(null);
      setCustomerSequenceLabelPrefix(null);
      setCustomerSequenceNumberFormat(null);
    } finally {
      setLoadingCustomerSequence(false);
    }
  }, []);

  const openNewBatchModal = useCallback(() => {
    setForm({
      customer_id: "",
      customer_search: "",
      initial_start_sequence: "1",
      sequence_count: "",
    });
    setLastBatchForCustomer(null);
    setCustomerSequenceOffset(null);
    setCustomerSequenceLabelPrefix(null);
    setCustomerSequenceNumberFormat(null);
    setFormError(null);
    setCustomerDropdownOpen(false);
    setModalOpen(true);
    fetchCustomersForDropdown();
  }, [fetchCustomersForDropdown]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setFormError(null);
    setCustomerDropdownOpen(false);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, closeModal]);

  useEffect(() => {
    if (!modalOpen) return;
    const onClick = (e: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [modalOpen]);

  useEffect(() => {
    if (modalOpen && form.customer_id) {
      fetchLastBatchForCustomer(form.customer_id);
      fetchCustomerSequence(form.customer_id);
    } else {
      setLastBatchForCustomer(null);
      setCustomerSequenceOffset(null);
      setCustomerSequenceLabelPrefix(null);
      setCustomerSequenceNumberFormat(null);
    }
  }, [modalOpen, form.customer_id, fetchLastBatchForCustomer, fetchCustomerSequence]);

  const selectedCustomer = form.customer_id
    ? customersForDropdown.find((c) => c.id === form.customer_id) ?? null
    : null;
  const customerSearchLower = form.customer_search.trim().toLowerCase();
  const filteredCustomers = customerSearchLower
    ? customersForDropdown.filter(
        (c) =>
          c.customer_num.toLowerCase().includes(customerSearchLower) ||
          (c.customer_description ?? "").toLowerCase().includes(customerSearchLower),
      )
    : customersForDropdown;

  const offsetNum = customerSequenceOffset;
  const countNum = parseInt(form.sequence_count, 10);
  const initialStartNum = parseInt(form.initial_start_sequence, 10);
  const computedStartSequence =
    lastBatchForCustomer != null && offsetNum != null && offsetNum > 0
      ? computeStartFromLastEnd(lastBatchForCustomer.end_sequence ?? 0, offsetNum)
      : Number.isNaN(initialStartNum) ? null : initialStartNum;
  const computedEndSequence =
    computedStartSequence != null &&
    !Number.isNaN(countNum) &&
    countNum >= 1 &&
    offsetNum != null &&
    offsetNum > 0
      ? computeEndFromStartOffsetCount(computedStartSequence, offsetNum, countNum)
      : null;

  const handleDownload = useCallback(async (batchId: string) => {
    try {
      const res = await fetch(`/api/batches/${batchId}/download`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error ?? `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? "batch.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Download failed");
    }
  }, []);

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id) {
      setFormError("Please select a customer.");
      return;
    }
    const count = parseInt(form.sequence_count, 10);
    if (customerSequenceOffset == null || customerSequenceOffset <= 0) {
      setFormError("This customer has no sequence pattern configured. Configure offset in Customer Sequence.");
      return;
    }
    if (Number.isNaN(count) || count < 1 || count > 1_000_000) {
      setFormError("Number of sequences must be between 1 and 1,000,000.");
      return;
    }
    if (computedStartSequence == null || computedEndSequence == null) {
      setFormError("Start and end sequence could not be computed. Check initial start (for first batch) and offset.");
      return;
    }
    if (lastBatchForCustomer == null) {
      const initialStart = parseInt(form.initial_start_sequence, 10);
      if (Number.isNaN(initialStart) || initialStart < 0) {
        setFormError("Initial start sequence must be 0 or greater.");
        return;
      }
    }
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: form.customer_id,
          start_sequence: computedStartSequence,
          end_sequence: computedEndSequence,
          offset_sequence: customerSequenceOffset,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error ?? "Failed to create batch");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? "batch.csv";
      a.click();
      URL.revokeObjectURL(url);
      closeModal();
      fetchBatches();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setFormSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Batches</h1>
          <p className="text-muted-foreground text-sm">
            Search and filter production batches by ID, customer, or date range.
          </p>
        </div>
        <Button onClick={openNewBatchModal} className="w-full sm:w-auto shrink-0">
          New batch
        </Button>
      </div>
      {customerId && (
        <p className="text-sm">
          Showing batches for customer{" "}
          <Link
            href={`/protected/customers/${customerId}`}
            className="text-primary hover:underline"
          >
            {customerId}
          </Link>
          . Clear filters to see all batches.
        </p>
      )}

      {/* Fixed filter bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              type="search"
              placeholder="Batch ID or customer name..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from">From date</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="to">To date</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={clearFilters}
            className="w-full md:w-auto"
          >
            Clear filters
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">
            {error}
          </div>
        )}
        <div className="px-4 py-2 border-b bg-muted/30 text-right text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : `${batches.length} of ${totalCount} Batch${totalCount === 1 ? "" : "es"}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-3">Batch ID</th>
                <th className="text-left font-medium p-3">Customer Num</th>
                <th className="text-left font-medium p-3">Label Prefix</th>
                <th className="text-left font-medium p-3">Number Format</th>
                <th className="text-left font-medium p-3">Created At</th>
                <th className="text-left font-medium p-3">Start Seq</th>
                <th className="text-left font-medium p-3">End Seq</th>
                <th className="text-left font-medium p-3">Offset</th>
                <th className="text-left font-medium p-3">Count</th>
                <th className="text-left font-medium p-3">Filename</th>
                <th className="text-left font-medium p-3 w-0">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    No batches match the current filters.
                  </td>
                </tr>
              ) : (
                batches.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-3 font-mono text-xs" title={row.id}>
                      …{row.id.slice(-6)}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.customer?.customer_num ?? "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.customer_sequence?.label_prefix ?? "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.customer_sequence?.number_format ?? "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {formatDate(row.created_date)}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.start_sequence != null ? row.start_sequence.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.end_sequence != null ? row.end_sequence.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.offset_sequence != null ? row.offset_sequence.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.label_count != null ? row.label_count.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      <div className="flex items-center gap-1.5 max-w-[10rem]">
                        <span className="truncate min-w-0" title={row.filename ?? undefined}>
                          {truncateFilename(row.filename)}
                        </span>
                        {row.filename ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={`h-7 w-7 shrink-0 ${copiedFilenameId === row.id ? "text-green-600 bg-green-500/15" : ""}`}
                            onClick={() => {
                              navigator.clipboard
                                .writeText(row.filename ?? "")
                                .then(() => {
                                  setCopiedFilenameId(row.id);
                                  window.setTimeout(() => setCopiedFilenameId(null), 2000);
                                })
                                .catch(() => {});
                            }}
                            title={copiedFilenameId === row.id ? "Copied!" : "Copy filename"}
                            aria-label={copiedFilenameId === row.id ? "Copied!" : "Copy filename"}
                          >
                            {copiedFilenameId === row.id ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => handleDownload(row.id)}
                      >
                        Download
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Batch modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
          onKeyDown={(e) => e.key === "Escape" && closeModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-batch-title"
        >
          <Card className="w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle id="new-batch-title">New batch</CardTitle>
                <CardDescription>
                  Create a new batch. Start sequence is taken from the last batch for the customer (last end + offset), or set an initial start for the first batch. Enter offset and how many sequences to print (1–1,000,000). A CSV file will download.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateBatch} className="space-y-4">
                <div className="space-y-2" ref={customerDropdownRef}>
                  <Label htmlFor="batch-customer">Customer *</Label>
                  <Input
                    id="batch-customer"
                    type="text"
                    value={selectedCustomer ? selectedCustomer.customer_num : form.customer_search}
                    onChange={(e) => {
                      setForm((f) => ({
                        ...f,
                        customer_search: e.target.value,
                        customer_id: "",
                      }));
                      setCustomerDropdownOpen(true);
                    }}
                    onFocus={() => setCustomerDropdownOpen(true)}
                    placeholder="Search by Customer Num..."
                    autoComplete="off"
                  />
                  {customerDropdownOpen && (
                    <div className="border rounded-md bg-popover shadow-md max-h-48 overflow-auto mt-1">
                      {loadingCustomers ? (
                        <div className="p-3 text-sm text-muted-foreground">Loading customers…</div>
                      ) : filteredCustomers.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">No customers match.</div>
                      ) : (
                        filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                            onClick={() => {
                              setForm((f) => ({
                                ...f,
                                customer_id: c.id,
                                customer_search: "",
                              }));
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
                {lastBatchForCustomer == null && !loadingLastBatch && form.customer_id && (
                  <div className="space-y-2">
                    <Label htmlFor="initial_start_sequence">Initial start sequence (first batch for this customer) *</Label>
                    <Input
                      id="initial_start_sequence"
                      type="number"
                      min={0}
                      step={1}
                      value={form.initial_start_sequence}
                      onChange={(e) => setForm((f) => ({ ...f, initial_start_sequence: e.target.value }))}
                      placeholder="e.g. 1"
                    />
                  </div>
                )}
                {lastBatchForCustomer != null && (
                  <p className="text-sm text-muted-foreground">
                    Last batch for this customer ended at sequence {lastBatchForCustomer.end_sequence}. Start will be last end + offset.
                  </p>
                )}
                {loadingLastBatch && form.customer_id && (
                  <p className="text-sm text-muted-foreground">Loading last batch…</p>
                )}
                <div className="space-y-2">
                  <Label>Customer sequence</Label>
                  {loadingCustomerSequence && form.customer_id ? (
                    <p className="text-sm text-muted-foreground py-2">Loading…</p>
                  ) : customerSequenceOffset != null && customerSequenceOffset > 0 ? (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-muted-foreground">Label prefix:</span>
                        <span className="font-mono">{customerSequenceLabelPrefix ?? "—"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-muted-foreground">Number format:</span>
                        <span className="font-mono">{customerSequenceNumberFormat ?? "—"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-border/50">
                        <span className="text-muted-foreground">Offset between sequences:</span>
                        <span className="font-mono">{customerSequenceOffset}</span>
                      </div>
                    </div>
                  ) : form.customer_id ? (
                    <p className="text-sm text-destructive">No sequence configured for this customer. Add a record in Customer Sequence.</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Select a customer to see sequence (label prefix, number format, offset).</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sequence_count">Number of sequences to print (1–1,000,000) *</Label>
                  <Input
                    id="sequence_count"
                    type="number"
                    min={1}
                    max={1_000_000}
                    step={1}
                    value={form.sequence_count}
                    onChange={(e) => setForm((f) => ({ ...f, sequence_count: e.target.value }))}
                    placeholder="e.g. 5"
                    required
                  />
                </div>
                {(computedStartSequence != null && computedEndSequence != null) && (
                  <div className="rounded-md bg-muted/50 p-3 text-sm">
                    <p className="font-medium">Computed range</p>
                    <p className="text-muted-foreground">
                      Start:{" "}
                      <span className="font-mono">
                        {(customerSequenceLabelPrefix ?? "") +
                          padSequenceNumber(
                            computedStartSequence,
                            customerSequenceNumberFormat ?? "",
                          )}
                      </span>{" "}
                      → End:{" "}
                      <span className="font-mono">
                        {(customerSequenceLabelPrefix ?? "") +
                          padSequenceNumber(
                            computedEndSequence,
                            customerSequenceNumberFormat ?? "",
                          )}
                      </span>
                      {countNum >= 1 && !Number.isNaN(countNum) && (
                        <> ({countNum} sequence{countNum === 1 ? "" : "s"})</>
                      )}
                    </p>
                  </div>
                )}
                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
                <div className="flex gap-2 justify-end pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    disabled={formSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={formSubmitting || customerSequenceOffset == null || customerSequenceOffset <= 0}
                  >
                    {formSubmitting ? "Creating…" : "Create batch"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {copiedFilenameId && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-lg"
          role="status"
          aria-live="polite"
        >
          Filename copied!
        </div>
      )}
    </div>
  );
}
