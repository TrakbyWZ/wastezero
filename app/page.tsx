import { LoginForm } from "@/app/login/login-form";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function LoginGate() {
  const session = await getSession();
  if (session) redirect("/protected/batch");

  return (
    <div className="w-full max-w-sm">
      <LoginForm />
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Suspense
        fallback={
          <div className="w-full max-w-sm animate-pulse rounded-md bg-muted h-64" />
        }
      >
        <LoginGate />
      </Suspense>
    </div>
  );
}
