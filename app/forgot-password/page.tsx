import { Suspense } from "react";
import Image from "next/image";
import { ForgotPasswordContent } from "./forgot-password-content";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm flex flex-col gap-6">
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
        <Suspense
          fallback={
            <div className="w-full max-w-sm animate-pulse rounded-md bg-muted h-64" />
          }
        >
          <ForgotPasswordContent />
        </Suspense>
      </div>
    </div>
  );
}
