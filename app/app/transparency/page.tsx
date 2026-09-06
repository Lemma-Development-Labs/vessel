import { Suspense } from "react";
import { TransparencyScreen } from "@/components/transparency-screen";
import { Skeleton } from "@/components/ui";

export default function TransparencyPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1080px] px-4 py-10">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-12 w-full max-w-xl" />
          <Skeleton className="mt-8 h-56 w-full" />
        </div>
      }
    >
      <TransparencyScreen />
    </Suspense>
  );
}
