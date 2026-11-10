import { RefundRequestStatus } from "~/db/schema";

export function RefundRequestStatusBadge({
  status,
}: {
  status: RefundRequestStatus;
}) {
  const styles: Record<RefundRequestStatus, string> = {
    [RefundRequestStatus.Pending]:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    [RefundRequestStatus.Approved]:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    [RefundRequestStatus.Declined]: "bg-muted text-muted-foreground",
  };
  const labels: Record<RefundRequestStatus, string> = {
    [RefundRequestStatus.Pending]: "Pending",
    [RefundRequestStatus.Approved]: "Approved",
    [RefundRequestStatus.Declined]: "Declined",
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
