import { Suspense } from "react";
import BatchDashboardClient from "./_components/batch-dashboard-client";

export default function BatchDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 w-full max-w-6xl">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <BatchDashboardClient />
    </Suspense>
  );
}
