"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { forceResetAction } from "./actions";
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

const RULES = [
  "At least 10 characters",
  "Uppercase and lowercase letters",
  "At least one number",
  "At least one special character (!@#$%^&* etc.)",
];

export function ForceResetForm({ className }: { className?: string }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [state, formAction, isPending] = useActionState(
    forceResetAction,
    undefined,
  );

  useEffect(() => {
    if (state?.success) {
      router.push("/protected/batch");
      router.refresh();
    }
  }, [state?.success, router]);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex justify-center">
        <Image
          src="/assets/waste-zero-logo.png"
          alt="WasteZero"
          width={160}
          height={44}
          className="h-11 w-auto object-contain"
          priority
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>
            You must change your password before continuing. Choose a strong
            password that meets the requirements below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="force-reset-password">New password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="force-reset-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="New password"
                  autoComplete="new-password"
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
            <div className="grid gap-2">
              <Label htmlFor="force-reset-confirm">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="force-reset-confirm"
                  name="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  required
                  className="pl-9 pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showConfirm ? "Hide password" : "Show password"
                  }
                >
                  {showConfirm ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {RULES.map((rule) => (
                <li key={rule} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                  {rule}
                </li>
              ))}
            </ul>
            {state?.error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
