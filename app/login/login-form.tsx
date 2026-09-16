"use client";

import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff, Mail, Lock, AlertCircle } from "lucide-react";
import { loginSchema } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const forgotPasswordEmailSchema = loginSchema.shape.email;

export function LoginForm({ className }: { className?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotForm, setShowForgotForm] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function resetForgotPasswordState() {
    setShowForgotForm(false);
    setForgotEmail("");
    setForgotError(null);
    setForgotMessage(null);
  }

  async function handleForgotPasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setForgotError(null);

    const parsed = forgotPasswordEmailSchema.safeParse(forgotEmail);
    if (!parsed.success) {
      setForgotError(parsed.error.issues[0]?.message ?? "Please enter a valid email address");
      return;
    }

    setForgotSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data.trim().toLowerCase() }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      setForgotMessage(
        data?.message ?? "If that email is registered, you'll receive a password reset link shortly."
      );
    } catch {
      setForgotMessage("If that email is registered, you'll receive a password reset link shortly.");
    } finally {
      setForgotSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const parsed = loginSchema.safeParse({
      email: formData.get("email") ?? "",
      password: formData.get("password") ?? "",
    });

    if (!parsed.success) {
      const first = parsed.error.flatten().fieldErrors;
      setError(
        first.email?.[0] ?? first.password?.[0] ?? "Invalid email or password."
      );
      return;
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    setIsPending(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        setError("Sign in failed (invalid response). Try again.");
        return;
      }

      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; needsPasswordReset?: boolean };
      if (!res.ok) {
        setError(data?.error ?? "Sign in failed");
        return;
      }

      if (data?.ok) {
        if (data.needsPasswordReset) {
          window.location.assign("/force-reset");
        } else {
          window.location.assign("/protected/batch");
        }
      }
      return;
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex justify-center">
        <Image
          src="/assets/trak_logo_color.png"
          alt="Trak by WasteZero"
          width={160}
          height={44}
          className="object-contain"
          priority
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            Enter your email and password to access your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="login-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  placeholder="jdoe@wastezero.com"
                  autoComplete="email"
                  required
                  className="pl-9"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Password</Label>
                <button
                  type="button"
                  onClick={() => setShowForgotForm(true)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="pl-9 pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {showForgotForm && (
        <div role="dialog" aria-live="polite" className="rounded-lg border bg-muted/50 p-4">
          {forgotMessage ? (
            <p className="text-sm text-muted-foreground">{forgotMessage}</p>
          ) : (
            <form onSubmit={handleForgotPasswordSubmit} className="flex flex-col gap-3">
              <div className="grid gap-2">
                <Label htmlFor="forgot-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="jdoe@wastezero.com"
                    autoComplete="email"
                    required
                    className="pl-9"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </div>
              </div>
              {forgotError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{forgotError}</span>
                </div>
              )}
              <Button type="submit" size="sm" disabled={forgotSubmitting}>
                {forgotSubmitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={resetForgotPasswordState}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
