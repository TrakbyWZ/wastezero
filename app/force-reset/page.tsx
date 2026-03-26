import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ForceResetForm } from "./force-reset-form";
import { Suspense } from "react";

async function ForceResetContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const email = user.email;
  if (email) {
    const admin = createAdminClient();
    const { data: userRow } = await admin
      .from("users")
      .select("needs_password_reset")
      .eq("email", email)
      .maybeSingle();
    if (userRow && !userRow.needs_password_reset) {
      redirect("/protected/batch");
    }
  }

  return (
    <div className="w-full max-w-sm">
      <ForceResetForm />
    </div>
  );
}

export default function ForceResetPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Suspense
        fallback={
          <div className="w-full max-w-sm animate-pulse rounded-md bg-muted h-64" />
        }
      >
        <ForceResetContent />
      </Suspense>
    </div>
  );
}
