import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { CustomerRow } from "@/lib/types";
import { NextResponse } from "next/server";

function matchesSearch(row: CustomerRow, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  const name =
    (row.customer_description ?? row.customer_num ?? "").toLowerCase();
  const email = (row.contact_email ?? "").toLowerCase();
  return name.includes(lower) || email.includes(lower);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const activeOnly =
    searchParams.get("active_only") === "true" ||
    searchParams.get("active_only") === "1";

  const supabase = createAdminClient();

  let query = supabase
    .from("vw_api_customers_list")
    .select("id, customer_num, customer_description, contact_email, is_active, created_date, batch_count")
    .order("customer_description", { ascending: true, nullsFirst: false })
    .order("customer_num", { ascending: true });

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data: customers, error: custError } = await query;

  if (custError) {
    return NextResponse.json({ error: custError.message }, { status: 500 });
  }

  const { count: totalCount, error: countError } = await supabase
    .from("vw_api_customers_list")
    .select("id", { count: "exact", head: true });

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const rows = (customers ?? []) as CustomerRow[];
  const filtered = rows.filter((row) => matchesSearch(row, q));
  return NextResponse.json({
    customers: filtered,
    total_count: totalCount ?? 0,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const customer_num =
      typeof body?.customer_num === "string" ? body.customer_num.trim() : null;
    const customer_description =
      typeof body?.customer_description === "string"
        ? body.customer_description.trim() || null
        : null;
    const contact_email =
      typeof body?.contact_email === "string"
        ? body.contact_email.trim() || null
        : null;
    const is_active =
      typeof body?.is_active === "boolean" ? body.is_active : true;

    if (!customer_num) {
      return NextResponse.json(
        { error: "Customer number is required" },
        { status: 400 },
      );
    }
    if (!/^[A-Za-z0-9_]+$/.test(customer_num)) {
      return NextResponse.json(
        {
          error:
            "Customer number must contain only letters, digits, and underscores (no spaces or other special characters).",
        },
        { status: 400 },
      );
    }

    const session = await getSession();
    const userId = session?.userId ?? null;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("customer")
      .insert({
        customer_num,
        customer_description: customer_description ?? null,
        contact_email,
        is_active,
        created_by: userId,
        modified_by: userId,
      })
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

    return NextResponse.json(data);
  } catch (e) {
    console.error("POST /api/customers error", e);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
