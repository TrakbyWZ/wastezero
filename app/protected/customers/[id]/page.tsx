"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CustomerDetail } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export default function CustomerDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : null;
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomer = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Customer not found");
          setCustomer(null);
          return;
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCustomer(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customer");
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  if (!id) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-6xl">
        <p className="text-destructive">Invalid customer ID.</p>
        <Link href="/protected/customers">
          <Button variant="outline">Back to customers</Button>
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-6xl">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-6xl">
        <p className="text-destructive">{error ?? "Customer not found"}</p>
        <Link href="/protected/customers">
          <Button variant="outline">Back to customers</Button>
        </Link>
      </div>
    );
  }

  const displayName =
    customer.customer_description ?? customer.customer_num ?? "—";

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl">
      <div className="flex flex-col gap-2">
        <Link
          href="/protected/customers"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Customers
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
        <p className="text-muted-foreground text-sm">
          Customer details and batches for this customer.
        </p>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <h2 className="font-semibold text-sm">Details</h2>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Customer ID</dt>
              <dd className="font-mono text-xs mt-0.5">{customer.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Customer number</dt>
              <dd className="mt-0.5">{customer.customer_num}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Customer name</dt>
              <dd className="mt-0.5">
                {customer.customer_description ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Contact email</dt>
              <dd className="mt-0.5">{customer.contact_email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="mt-0.5">
                <Badge variant={customer.is_active ? "default" : "secondary"}>
                  {customer.is_active ? "Active" : "Inactive"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5">{formatDate(customer.created_date)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total batches</dt>
              <dd className="mt-0.5">{customer.batch_count}</dd>
            </div>
          </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Batches</h2>
        <p className="text-muted-foreground text-sm">
          View all batches for this customer on the Batch page.
        </p>
        <Link href={`/protected/batch?customer=${customer.id}`}>
          <Button variant="outline">View batches for this customer</Button>
        </Link>
      </div>
    </div>
  );
}
