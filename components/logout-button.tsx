"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <Button
      size="sm"
      onClick={logout}
      className="w-full lg:w-auto justify-center gap-2 bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-500"
      aria-label="Sign out"
    >
      <LogOut className="h-3.5 w-3.5 shrink-0" />
      Sign out
    </Button>
  );
}
