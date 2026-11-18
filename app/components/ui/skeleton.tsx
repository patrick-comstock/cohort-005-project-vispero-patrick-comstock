import { cn } from "~/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * Keys for a run of `count` loading placeholders. Placeholders have no data
 * and are never reordered, so a key built from their position is stable.
 */
function skeletonKeys(count: number) {
  return Array.from({ length: count }, (_, position) => `skeleton-${position}`);
}

export { Skeleton, skeletonKeys };
