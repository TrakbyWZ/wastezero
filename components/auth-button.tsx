import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? (
    <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-3 w-full min-w-0">
      <p
        className="text-xs text-muted-foreground truncate"
        title={user.email ?? undefined}
      >
        {user.email}
      </p>
      <LogoutButton />
    </div>
  ) : (
    <Button asChild size="sm" variant="outline" className="w-full">
      <Link href="/login">Sign in</Link>
    </Button>
  );
}
