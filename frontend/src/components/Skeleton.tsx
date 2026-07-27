import clsx from "clsx";

export function Skeleton({
  className,
  as: Tag = "div",
}: {
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}) {
  return (
    <Tag
      className={clsx(
        "animate-breathe rounded-md bg-zinc-200/70 dark:bg-zinc-800/60",
        className,
      )}
    />
  );
}

export function SkeletonText({ w = "w-full", className }: { w?: string; className?: string }) {
  return <Skeleton className={clsx("h-3", w, className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx("card p-5 space-y-3", className)}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-800/40">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-3 px-5 py-3" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} className={clsx("h-3", j === 0 ? "w-3/4" : "w-1/2")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonKanban({ cols = 5, cards = 3 }: { cols?: number; cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: cols }).map((_, ci) => (
        <div key={ci} className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-2.5 dark:border-zinc-700/50 dark:bg-[#22222a]">
          <div className="mb-2 flex items-center justify-between px-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-4" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: cards }).map((_, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700/50 dark:bg-[#2b2b34]">
                <Skeleton className="mb-2 h-3 w-4/5" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
