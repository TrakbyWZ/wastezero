"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Check your email</CardTitle>
        <CardDescription>
          {email
            ? `If ${email} is registered, you'll receive a password reset link shortly.`
            : "If that email is registered, you'll receive a password reset link shortly."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login" className="text-sm underline underline-offset-4">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
