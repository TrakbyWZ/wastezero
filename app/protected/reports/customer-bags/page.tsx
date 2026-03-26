import { Suspense } from "react";
import CustomerBagsReportClient from "./_components/customer-bags-report-client";

export default function CustomerBagsReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 w-full max-w-6xl">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <CustomerBagsReportClient />
    </Suspense>
  );
}
