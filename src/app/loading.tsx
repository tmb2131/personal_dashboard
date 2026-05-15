import { SectionSkeleton } from "./_panels/section-skeleton";

export default function DashboardLoading() {
  return (
    <main className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="px-4 pt-5 pb-4 sm:flex sm:items-baseline sm:gap-6 sm:px-8 sm:pt-6 sm:pb-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <div className="h-7 w-32 animate-pulse rounded bg-pill-bg" />
          <div className="h-6 w-24 animate-pulse rounded bg-pill-bg" />
        </div>
        <div className="mt-3 flex items-center gap-3 sm:mt-0 sm:ml-2">
          <div className="h-3 w-16 animate-pulse rounded bg-pill-bg" />
          <span className="text-fg-subtle">·</span>
          <div className="h-3 w-20 animate-pulse rounded bg-pill-bg" />
        </div>
        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <div className="h-5 w-20 animate-pulse rounded-full bg-pill-bg" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-pill-bg" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-pill-bg" />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-6 px-4 sm:px-6 md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,360px)]">
        <div className="min-w-0">
          <SectionSkeleton lines={4} />
          <SectionSkeleton lines={3} />
        </div>
        <div className="min-w-0">
          <SectionSkeleton lines={5} />
        </div>
        <div className="min-w-0">
          <SectionSkeleton lines={4} />
        </div>
      </div>
      <footer className="flex items-center gap-4 border-t border-border px-4 py-3 sm:px-8">
        <div className="h-3 w-24 animate-pulse rounded bg-pill-bg" />
        <div className="h-3 w-20 animate-pulse rounded bg-pill-bg" />
        <div className="ml-auto h-3 w-28 animate-pulse rounded bg-pill-bg" />
      </footer>
    </main>
  );
}
