import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "@/components/update-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

async function UpdatePasswordContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Link expired</CardTitle>
          <CardDescription>
            This password reset link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Ask an administrator to send a new password reset email, then try
            again.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block text-sm underline underline-offset-4"
          >
            Back to login
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <UpdatePasswordForm />;
}

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense
          fallback={
            <div className="w-full max-w-sm animate-pulse rounded-md bg-muted h-64" />
          }
        >
          <UpdatePasswordContent />
        </Suspense>
      </div>
    </div>
  );
}
