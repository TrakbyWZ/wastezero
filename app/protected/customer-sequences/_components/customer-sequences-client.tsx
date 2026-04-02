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
import { Checkbox } from "@/components/ui/checkbox";
import type { CustomerSequenceRow, CustomerRow } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

export default function CustomerSequencesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customer") ?? "";
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sequences, setSequences] = useState<CustomerSequenceRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [customersForDropdown, setCustomersForDropdown] = useState<CustomerRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [blockedActionMessage, setBlockedActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: "",
    customer_search: "",
    label_prefix: "",
    number_format: "",
    start_seq: "1",
    end_seq: "",
    offset_sequence: "1",
    is_default: false,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchSequences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (customerId) params.set("customer", customerId);
      const res = await fetch(`/api/customer-sequences?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSequences(data.sequences ?? []);
      setTotalCount(typeof data.total_count === "number" ? data.total_count : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sequences");
      setSequences([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, customerId]);

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  const clearFilters = useCallback(() => {
    setQ("");
    setDebouncedQ("");
    if (customerId) {
      router.replace("/protected/customer-sequences");
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

  const openNewModal = useCallback(() => {
    setEditingId(null);
    setForm({
      customer_id: "",
      customer_search: "",
      label_prefix: "",
      number_format: "",
      start_seq: "1",
      end_seq: "",
      offset_sequence: "1",
      is_default: false,
    });
    setFormError(null);
    setCustomerDropdownOpen(false);
    setModalOpen(true);
    fetchCustomersForDropdown();
  }, [fetchCustomersForDropdown]);

  const openEditModal = useCallback(
    async (row: CustomerSequenceRow) => {
      setEditingId(row.id);
      setForm({
        customer_id: row.customer_id,
        customer_search: row.customer ? row.customer.customer_num : "",
        label_prefix: row.label_prefix ?? "",
        number_format: row.number_format ?? "",
        start_seq: row.start_seq != null ? String(row.start_seq) : "1",
        end_seq: row.end_seq != null ? String(row.end_seq) : "",
        offset_sequence: row.offset_sequence != null ? String(row.offset_sequence) : "1",
        is_default: row.is_default === true,
      });
      setFormError(null);
      setCustomerDropdownOpen(false);
      setModalOpen(true);
      fetchCustomersForDropdown();
    },
    [fetchCustomersForDropdown],
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
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

  const buildPatchBody = (switchDefault: boolean, offset: number) => ({
    label_prefix: form.label_prefix.trim() || null,
    number_format: form.number_format.trim() || null,
    start_seq: form.start_seq ? parseInt(form.start_seq, 10) : null,
    end_seq: form.end_seq ? parseInt(form.end_seq, 10) : null,
    offset_sequence: offset,
    is_default: form.is_default,
    ...(switchDefault ? { switch_default: true } : {}),
  });

  const handleSubmit = async (e: React.FormEvent, retryWithSwitchDefault = false) => {
    e.preventDefault();
    if (!editingId && !form.customer_id) {
      setFormError("Please select a customer.");
      return;
    }
    const offsetNum = parseInt(form.offset_sequence, 10);
    if (Number.isNaN(offsetNum) || offsetNum === 0) {
      setFormError("Offset sequence cannot be 0.");
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingId) {
        const body = buildPatchBody(retryWithSwitchDefault, offsetNum);
        const res = await fetch(`/api/customer-sequences/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 409 && data.code === "DEFAULT_EXISTS") {
            const ok = window.confirm(data.error ?? "Switch the default to this sequence?");
            if (ok) void handleSubmit(e, true);
            return;
          }
          setFormError(data.error ?? "Failed to update sequence");
          return;
        }
        closeModal();
        fetchSequences();
      } else {
        const body = {
          customer_id: form.customer_id,
          label_prefix: form.label_prefix.trim() || null,
          number_format: form.number_format.trim() || null,
          start_seq: form.start_seq ? parseInt(form.start_seq, 10) : 1,
          end_seq: form.end_seq ? parseInt(form.end_seq, 10) : null,
          offset_sequence: offsetNum,
          is_default: form.is_default,
          ...(retryWithSwitchDefault ? { switch_default: true } : {}),
        };
        const res = await fetch("/api/customer-sequences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 409 && data.code === "DEFAULT_EXISTS") {
            const ok = window.confirm(data.error ?? "Switch the default to this sequence?");
            if (ok) void handleSubmit(e, true);
            return;
          }
          setFormError(data.error ?? "Failed to create sequence");
          return;
        }
        closeModal();
        fetchSequences();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setFormSubmitting(false);
    }
  };

  const openDeleteConfirm = useCallback((id: string) => {
    setDeleteError(null);
    setDeleteConfirmId(id);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    if (!deleteSubmitting) {
      setDeleteConfirmId(null);
      setDeleteError(null);
    }
  }, [deleteSubmitting]);

  const handleDeleteConfirm = useCallback(
    async (id: string) => {
      setDeleteSubmitting(true);
      setDeleteError(null);
      try {
        const res = await fetch(`/api/customer-sequences/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDeleteError(data.error ?? "Failed to delete");
          return;
        }
        setDeleteConfirmId(null);
        fetchSequences();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Delete failed");
      } finally {
        setDeleteSubmitting(false);
      }
    },
    [fetchSequences],
  );

  const showBlockedActionMessage = useCallback((message: string) => {
    setBlockedActionMessage(message);
    window.setTimeout(() => setBlockedActionMessage(null), 2500);
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer Sequences</h1>
          <p className="text-muted-foreground text-sm">
            Manage sequence settings per customer: label prefix, number format, start/end, and offset.
          </p>
        </div>
        <Button onClick={openNewModal} className="w-full sm:w-auto shrink-0">
          New sequence
        </Button>
      </div>
      {customerId && (
        <p className="text-sm">
          Showing sequences for customer{" "}
          <Link
            href={`/protected/customers/${customerId}`}
            className="text-primary hover:underline"
          >
            {customerId}
          </Link>
          . Clear filters to see all.
        </p>
      )}

      {/* Fixed filter bar - same pattern as Batch Management */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              type="search"
              placeholder="Customer name or label prefix..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full"
              autoComplete="off"
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

      {/* Table - same structure as Batch page */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm border-b">
            {error}
          </div>
        )}
        <div className="px-4 py-2 border-b bg-muted/30 text-right text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : `${sequences.length} of ${totalCount} Sequence${totalCount === 1 ? "" : "s"}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-3">Sequence ID</th>
                <th className="text-left font-medium p-3">Customer</th>
                <th className="text-left font-medium p-3">Label Prefix</th>
                <th className="text-left font-medium p-3">Number Format</th>
                <th className="text-left font-medium p-3">Start</th>
                <th className="text-left font-medium p-3">End</th>
                <th className="text-left font-medium p-3">Offset</th>
                <th className="text-left font-medium p-3">Default</th>
                <th className="text-left font-medium p-3">Modified</th>
                <th className="text-left font-medium p-3 w-0">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : sequences.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    No sequences match the current filters.
                  </td>
                </tr>
              ) : (
                sequences.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-3 font-mono text-xs" title={row.id}>
                      …{row.id.slice(-6)}
                    </td>
                    <td className="p-3">
                      <Link
                        href={`/protected/customers/${row.customer_id}`}
                        className="text-primary hover:underline font-mono text-xs"
                      >
                        {row.customer?.customer_num ?? "—"}
                      </Link>
                    </td>
                    <td className="p-3 font-mono text-xs">{row.label_prefix ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">{row.number_format ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">
                      {row.start_seq != null ? row.start_seq.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.end_seq != null ? row.end_seq.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.offset_sequence != null ? row.offset_sequence.toLocaleString() : "—"}
                    </td>
                    <td className="p-3">
                      {row.is_default === true ? (
                        <span className="text-muted-foreground">Yes</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {formatDate(row.modified_date)}
                    </td>
                    <td className="p-3 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => {
                          if (row.used_in_batch) {
                            showBlockedActionMessage("This sequence cannot be edited because it is used by a batch.");
                            return;
                          }
                          void openEditModal(row);
                        }}
                        aria-disabled={row.used_in_batch ? true : undefined}
                        title={row.used_in_batch ? "This sequence cannot be edited because it is used by a batch." : undefined}
                        className={row.used_in_batch ? "opacity-50 cursor-not-allowed" : undefined}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => {
                          if (row.used_in_batch) {
                            showBlockedActionMessage("This sequence cannot be deleted because it is used by a batch.");
                            return;
                          }
                          openDeleteConfirm(row.id);
                        }}
                        aria-disabled={row.used_in_batch ? true : undefined}
                        title={row.used_in_batch ? "This sequence cannot be deleted because it is used by a batch." : undefined}
                        className={`text-destructive hover:text-destructive ${row.used_in_batch ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmId && (() => {
        const seq = sequences.find((s) => s.id === deleteConfirmId);
        const customerLabel =
          seq?.customer?.customer_description ?? seq?.customer?.customer_num ?? "—";
        return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeDeleteConfirm()}
          onKeyDown={(e) => e.key === "Escape" && closeDeleteConfirm()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <Card className="w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle id="delete-confirm-title">Delete Customer Sequence?</CardTitle>
              <CardDescription>
                Are you sure you want to delete Sequence ID {deleteConfirmId} for Customer {customerLabel}?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {deleteError && (
                <p className="text-sm text-destructive">{deleteError}</p>
              )}
              <div className="flex flex-row gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDeleteConfirm}
                  disabled={deleteSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => handleDeleteConfirm(deleteConfirmId)}
                  disabled={deleteSubmitting}
                >
                  {deleteSubmitting ? "Deleting…" : "Yes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        );
      })()}

      {/* New / Edit modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
          onKeyDown={(e) => e.key === "Escape" && closeModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sequence-modal-title"
        >
          <Card className="w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle id="sequence-modal-title">
                  {editingId ? "Edit sequence" : "New sequence"}
                </CardTitle>
                <CardDescription>
                  {editingId
                    ? "Update label prefix, number format, start/end, and offset."
                    : "Add a sequence pattern for a customer. Used when creating batches."}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2" ref={customerDropdownRef}>
                  <Label htmlFor="sequence-customer">Customer *</Label>
                  <Input
                    id="sequence-customer"
                    type="text"
                    value={selectedCustomer ? selectedCustomer.customer_num : form.customer_search}
                    onChange={(e) => {
                      setForm((f) => ({
                        ...f,
                        customer_search: e.target.value,
                        customer_id: editingId ? f.customer_id : "",
                      }));
                      setCustomerDropdownOpen(true);
                    }}
                    onFocus={() => setCustomerDropdownOpen(true)}
                    placeholder="Search by Customer Num..."
                    autoComplete="off"
                    disabled={!!editingId}
                  />
                  {!editingId && customerDropdownOpen && (
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
                <div className="space-y-2">
                  <Label htmlFor="label_prefix">Label prefix</Label>
                  <Input
                    id="label_prefix"
                    type="text"
                    value={form.label_prefix}
                    onChange={(e) => setForm((f) => ({ ...f, label_prefix: e.target.value }))}
                    placeholder="e.g. R002C"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="number_format">Number format</Label>
                  <Input
                    id="number_format"
                    type="text"
                    value={form.number_format}
                    onChange={(e) => setForm((f) => ({ ...f, number_format: e.target.value }))}
                    placeholder="e.g. 0000000"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start_seq">Start seq</Label>
                    <Input
                      id="start_seq"
                      type="number"
                      step={1}
                      value={form.start_seq}
                      onChange={(e) => setForm((f) => ({ ...f, start_seq: e.target.value }))}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end_seq">End seq (optional)</Label>
                    <Input
                      id="end_seq"
                      type="number"
                      step={1}
                      value={form.end_seq}
                      onChange={(e) => setForm((f) => ({ ...f, end_seq: e.target.value }))}
                      placeholder="—"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="offset_sequence">Offset sequence *</Label>
                  <Input
                    id="offset_sequence"
                    type="number"
                    step={1}
                    value={form.offset_sequence}
                    onChange={(e) => setForm((f) => ({ ...f, offset_sequence: e.target.value }))}
                    placeholder="1"
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="is_default"
                    checked={form.is_default}
                    onCheckedChange={(v) =>
                      setForm((f) => ({ ...f, is_default: v === true }))
                    }
                  />
                  <Label htmlFor="is_default" className="cursor-pointer font-normal">
                    Default sequence for this customer
                  </Label>
                </div>
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
                  <Button type="submit" disabled={formSubmitting}>
                    {formSubmitting
                      ? editingId
                        ? "Saving…"
                        : "Creating…"
                      : editingId
                        ? "Save"
                        : "Create sequence"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
      {blockedActionMessage && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-lg"
          role="status"
          aria-live="polite"
        >
          {blockedActionMessage}
        </div>
      )}
    </div>
  );
}
