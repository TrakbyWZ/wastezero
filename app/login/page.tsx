import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { Suspense } from "react";
import { AlertCircle } from "lucide-react";

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/protected/batch");

  const { error } = await searchParams;
  const inactiveMessage =
    error === "inactive"
      ? "Your account is inactive. Contact your administrator."
      : null;

  return (
    <div className="w-full max-w-sm space-y-4">
      {inactiveMessage && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{inactiveMessage}</span>
        </div>
      )}
      <LoginForm />
    </div>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Suspense
        fallback={
          <div className="w-full max-w-sm animate-pulse rounded-md bg-muted h-64" />
        }
      >
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
