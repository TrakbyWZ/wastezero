"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { CustomerRow } from "@/lib/types";

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_num: "",
    customer_description: "",
    contact_email: "",
    is_active: true,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (activeOnly) params.set("active_only", "true");
      const res = await fetch(`/api/customers?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCustomers(data.customers ?? []);
      setTotalCount(typeof data.total_count === "number" ? data.total_count : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customers");
      setCustomers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, activeOnly]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const clearFilters = useCallback(() => {
    setQ("");
    setDebouncedQ("");
    setActiveOnly(true);
  }, []);

  const openAddModal = useCallback(() => {
    setForm({
      customer_num: "",
      customer_description: "",
      contact_email: "",
      is_active: true,
    });
    setFormError(null);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setFormError(null);
  }, []);

  const openEditModal = useCallback((row: CustomerRow) => {
    setForm({
      customer_num: row.customer_num,
      customer_description: row.customer_description ?? "",
      contact_email: row.contact_email ?? "",
      is_active: row.is_active,
    });
    setFormError(null);
    setEditingCustomer(row);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditingCustomer(null);
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!modalOpen && !editingCustomer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingCustomer) closeEditModal();
        else closeModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, editingCustomer, closeModal, closeEditModal]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_num: form.customer_num.trim(),
          customer_description: form.customer_description.trim() || null,
          contact_email: form.contact_email.trim() || null,
          is_active: form.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "Something went wrong");
        return;
      }
      closeModal();
      fetchCustomers();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/customers/${editingCustomer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_num: form.customer_num.trim(),
          customer_description: form.customer_description.trim() || null,
          contact_email: form.contact_email.trim() || null,
          is_active: form.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "Something went wrong");
        return;
      }
      closeEditModal();
      fetchCustomers();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setFormSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Customer Management
          </h1>
          <p className="text-muted-foreground text-sm">
            View, search, and manage authorized customers.
          </p>
        </div>
        <Button onClick={openAddModal} className="w-full sm:w-auto shrink-0">
          Add new customer
        </Button>
      </div>

      {/* Fixed filter bar - same pattern as Batch page */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div className="space-y-2">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              type="search"
              placeholder="Name or email..."
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
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-start gap-3">
            <Checkbox
              id="active_only"
              checked={activeOnly}
              onCheckedChange={(checked) => setActiveOnly(checked === true)}
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="active_only"
                className="font-normal cursor-pointer text-sm leading-tight"
              >
                Show only active customers
              </Label>
              <p className="text-muted-foreground text-xs">
                {activeOnly
                  ? "Only active customers are visible. Uncheck to see all customers (including inactive)."
                  : "Showing all customers. Check the box above to show only active customers."}
              </p>
            </div>
          </div>
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
            : `${customers.length} of ${totalCount} Customer${totalCount === 1 ? "" : "s"}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium p-3">Customer ID</th>
                <th className="text-left font-medium p-3">Customer Num</th>
                <th className="text-left font-medium p-3">Customer Name</th>
                <th className="text-left font-medium p-3">Contact Email</th>
                <th className="text-left font-medium p-3">Total Batches</th>
                <th className="text-left font-medium p-3">Status</th>
                <th className="text-left font-medium p-3 w-0">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="p-8 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="p-8 text-center text-muted-foreground"
                  >
                    No customers found.
                  </td>
                </tr>
              ) : (
                customers.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-b-0 even:bg-muted/25 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-3">
                      <Link
                        href={`/protected/customers/${row.id}`}
                        className="font-mono text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                        title={row.id}
                      >
                        …{row.id.slice(-6)}
                      </Link>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {row.customer_num}
                    </td>
                    <td className="p-3">
                      <Link
                        href={`/protected/customers/${row.id}`}
                        className="text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                      >
                        {row.customer_description ?? "—"}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.contact_email ?? "—"}
                    </td>
                    <td className="p-3">{row.batch_count ?? 0}</td>
                    <td className="p-3">
                      <Badge
                        variant={
                          row.is_active ? "default" : "secondary"
                        }
                      >
                        {row.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(row)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Customer modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
          onKeyDown={(e) => e.key === "Escape" && closeModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-customer-title"
        >
          <Card className="w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle id="add-customer-title">Add new customer</CardTitle>
                <CardDescription>
                  Create a new customer record. Customer number must be unique and contain only letters, digits, and underscores (no spaces or other special characters).
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddCustomer} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="customer_num">Customer number *</Label>
                  <Input
                    id="customer_num"
                    value={form.customer_num}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customer_num: e.target.value }))
                    }
                    placeholder="e.g. ACME"
                    required
                    autoFocus
                    pattern="[A-Za-z0-9_]+"
                    title="Letters, digits, and underscores only (no spaces or other special characters)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer_description">Customer name</Label>
                  <Input
                    id="customer_description"
                    value={form.customer_description}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        customer_description: e.target.value,
                      }))
                    }
                    placeholder="Display name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_email">Contact email</Label>
                  <Input
                    id="contact_email"
                    type="email"
                    value={form.contact_email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contact_email: e.target.value }))
                    }
                    placeholder="contact@example.com"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_active"
                    checked={form.is_active}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, is_active: checked === true }))
                    }
                  />
                  <Label htmlFor="is_active" className="font-normal cursor-pointer">
                    Active
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
                    {formSubmitting ? "Adding…" : "Add customer"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Customer modal */}
      {editingCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && closeEditModal()}
          onKeyDown={(e) => e.key === "Escape" && closeEditModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-customer-title"
        >
          <Card className="w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle id="edit-customer-title">Edit customer</CardTitle>
                <CardDescription>
                  Update customer information. Customer number must be unique and contain only letters, digits, and underscores (no spaces or other special characters).
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEditCustomer} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_customer_num">Customer number *</Label>
                  <Input
                    id="edit_customer_num"
                    value={form.customer_num}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customer_num: e.target.value }))
                    }
                    placeholder="e.g. ACME, BEN10"
                    required
                    autoFocus
                    pattern="[A-Za-z0-9_]+"
                    title="Letters, digits, and underscores only (no spaces or other special characters)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_customer_description">Customer name</Label>
                  <Input
                    id="edit_customer_description"
                    value={form.customer_description}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        customer_description: e.target.value,
                      }))
                    }
                    placeholder="Display name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_contact_email">Contact email</Label>
                  <Input
                    id="edit_contact_email"
                    type="email"
                    value={form.contact_email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contact_email: e.target.value }))
                    }
                    placeholder="contact@example.com"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit_is_active"
                    checked={form.is_active}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, is_active: checked === true }))
                    }
                  />
                  <Label htmlFor="edit_is_active" className="font-normal cursor-pointer">
                    Active
                  </Label>
                </div>
                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
                <div className="flex gap-2 justify-end pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeEditModal}
                    disabled={formSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={formSubmitting}>
                    {formSubmitting ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
