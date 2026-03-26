import { Suspense } from "react";
import CustomerSequencesClient from "./_components/customer-sequences-client";

export default function CustomerSequencesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 w-full max-w-6xl">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <CustomerSequencesClient />
    </Suspense>
  );
}
