"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";

type ConfirmDialogProps = {
  titleId: string;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  titleId,
  title,
  description,
  confirmLabel = "Yes",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader>
            <CardTitle id={titleId}>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onCancel}>
                {cancelLabel}
              </Button>
              <Button type="button" variant={confirmVariant} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
