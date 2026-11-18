/**
 * The two empty states for Revenue: a period with no Purchases, and one whose
 * Purchases were all Refunded.
 */
export function NoSales({ isAllRefunded }: { isAllRefunded: boolean }) {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      {isAllRefunded
        ? "All sales in this period were Refunded."
        : "No sales in this period yet."}
    </p>
  );
}
