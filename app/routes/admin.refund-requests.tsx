import { Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/admin.refund-requests";
import { requireAdmin } from "~/lib/access.server";
import { listRefundRequests } from "~/lib/refund-requests.server";
import { db } from "~/db";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { RefundRequestStatusBadge } from "~/components/refund-request-status-badge";
import { formatPrice } from "~/lib/utils";
import { AlertTriangle, ReceiptText } from "lucide-react";

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Resolve Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return listRefundRequests(db);
}

type RefundRequestListItem = Awaited<
  ReturnType<typeof loader>
>["pending"][number];

function RepeatRefundRequestBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
      Refunded before ×{count}
    </span>
  );
}

function RefundRequestTable({
  refundRequests,
  dateLabel,
}: {
  refundRequests: RefundRequestListItem[];
  dateLabel: "Requested" | "Resolved";
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {["Requester", "Course", "Amount paid", dateLabel, "Status"].map(
              (heading) => (
                <th
                  key={heading}
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {heading}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {refundRequests.map((refundRequest) => {
            const date =
              dateLabel === "Requested"
                ? refundRequest.requestedAt
                : refundRequest.resolvedAt;
            return (
              <tr
                key={refundRequest.id}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/refund-requests/${refundRequest.id}`}
                    className="font-medium hover:underline"
                  >
                    {refundRequest.userName}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {refundRequest.isTeamPurchase && (
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                        Team Purchase
                      </span>
                    )}
                    <RepeatRefundRequestBadge
                      count={refundRequest.earlierApprovedCount}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {refundRequest.courseTitle}
                </td>
                <td className="px-4 py-3">
                  {formatPrice(refundRequest.amountPaid)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {date ? new Date(date).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <RefundRequestStatusBadge status={refundRequest.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { pending, resolved } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Review each Pending Refund Request and Approve or Decline it
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <h2 className="text-lg font-semibold">Pending</h2>
          <p className="text-sm text-muted-foreground">Oldest first</p>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <div className="py-8 text-center">
              <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                No Pending Refund Requests.
              </p>
            </div>
          ) : (
            <RefundRequestTable
              refundRequests={pending}
              dateLabel="Requested"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Resolved</h2>
          <p className="text-sm text-muted-foreground">
            Most recently Resolved first
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {resolved.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No Resolved Refund Requests yet.
            </p>
          ) : (
            <RefundRequestTable
              refundRequests={resolved}
              dateLabel="Resolved"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
