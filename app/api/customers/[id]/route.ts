import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { CustomerDetail } from "@/lib/types";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Customer ID required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: customer, error: custError } = await supabase
    .from("vw_api_customers_list")
    .select("id, customer_num, customer_description, contact_email, is_active, created_date, batch_count")
    .eq("id", id)
    .single();

  if (custError || !customer) {
    return NextResponse.json(
      { error: custError?.message ?? "Customer not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(customer as CustomerDetail);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Customer ID required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const customer_num =
      typeof body?.customer_num === "string" ? body.customer_num.trim() : undefined;
    const customer_description =
      typeof body?.customer_description === "string"
        ? body.customer_description.trim() || null
        : undefined;
    const contact_email =
      typeof body?.contact_email === "string"
        ? body.contact_email.trim() || null
        : undefined;
    const is_active =
      typeof body?.is_active === "boolean" ? body.is_active : undefined;

    if (
      customer_num === undefined &&
      customer_description === undefined &&
      contact_email === undefined &&
      is_active === undefined
    ) {
      return NextResponse.json(
        { error: "At least one field to update is required" },
        { status: 400 },
      );
    }

    if (customer_num !== undefined && !customer_num) {
      return NextResponse.json(
        { error: "Customer number cannot be empty" },
        { status: 400 },
      );
    }
    if (customer_num !== undefined && !/^[A-Za-z0-9_]+$/.test(customer_num)) {
      return NextResponse.json(
        {
          error:
            "Customer number must contain only letters, digits, and underscores (no spaces or other special characters).",
        },
        { status: 400 },
      );
    }

    const session = await getSession();
    const admin = createAdminClient();

    const updates: Record<string, unknown> = {
      modified_by: session?.userId ?? null,
    };
    if (customer_num !== undefined) updates.customer_num = customer_num;
    if (customer_description !== undefined)
      updates.customer_description = customer_description;
    if (contact_email !== undefined) updates.contact_email = contact_email;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await admin
      .from("customer")
      .update(updates)
      .eq("id", id)
      .select("id, customer_num, customer_description, contact_email, is_active, created_date")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "A customer with this customer number already exists" },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("PATCH /api/customers/[id] error", e);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
