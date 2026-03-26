import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { hasEnvVars } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function ProtectedLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen flex">
      <AppSidebar
        trailing={
          <>
            <ThemeSwitcher />
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </>
        }
      />
      <main className="flex-1 flex flex-col min-h-screen pt-14">
        <div className="flex-1 flex flex-col gap-20 max-w-5xl w-full p-5 mx-auto">
          {children}
        </div>
        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs py-16">
          <p className="text-muted-foreground">
            <span>Trak by </span>
            <span style={{ color: "var(--wastezero-blue)" }}>Waste</span>
            <span style={{ color: "var(--wastezero-green)" }}>Zero</span> © 2026
          </p>
        </footer>
      </main>
    </div>
  );
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex flex-col items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <ProtectedLayoutInner>{children}</ProtectedLayoutInner>
    </Suspense>
  );
}
