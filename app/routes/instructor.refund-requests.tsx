import { Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.refund-requests";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import { listInstructorRefundRequests } from "~/lib/instructor-refund-requests.server";
import { db } from "~/db";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { RefundRequestStatusBadge } from "~/components/refund-request-status-badge";
import { AlertTriangle, ReceiptText } from "lucide-react";

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    {
      name: "description",
      content: "Refund Requests for your courses",
    },
  ];
}

// Read-only: this route has no action. Only Admins Resolve, from
// /admin/refund-requests, which stays Admin-only.
export async function loader({ request }: Route.LoaderArgs) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(request);
  // Admins see every course; Instructors see only their own.
  return listInstructorRefundRequests(db, isAdmin ? null : userId);
}

type RefundRequestListItem = Awaited<
  ReturnType<typeof loader>
>["pending"][number];

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

function RefundRequestTable({
  refundRequests,
  showResolution,
}: {
  refundRequests: RefundRequestListItem[];
  showResolution: boolean;
}) {
  const headings = [
    "Requester",
    "Course",
    "Purchased",
    "Requested",
    ...(showResolution ? ["Resolved"] : []),
    "Status",
    "Reason",
    ...(showResolution ? ["Resolution Note"] : []),
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {headings.map((heading) => (
              <th
                key={heading}
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {refundRequests.map((refundRequest) => (
            <tr
              key={refundRequest.id}
              className="border-b border-border align-top last:border-0"
            >
              <td className="px-4 py-3">
                <div className="font-medium">{refundRequest.requesterName}</div>
                <div className="text-xs text-muted-foreground">
                  {refundRequest.requesterEmail}
                </div>
                {refundRequest.isTeamPurchase && (
                  <span className="mt-1 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    Team Purchase
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {refundRequest.courseTitle}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(refundRequest.purchasedAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(refundRequest.requestedAt)}
              </td>
              {showResolution && (
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(refundRequest.resolvedAt)}
                </td>
              )}
              <td className="px-4 py-3">
                <RefundRequestStatusBadge status={refundRequest.status} />
              </td>
              <td className="max-w-xs whitespace-pre-wrap px-4 py-3">
                {refundRequest.reason}
              </td>
              {showResolution && (
                <td className="max-w-xs whitespace-pre-wrap px-4 py-3">
                  {refundRequest.resolutionNote ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InstructorRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { pending, resolved } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Refund Requests for your courses. Only Admins Resolve Refund Requests.
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
              showResolution={false}
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
            <RefundRequestTable refundRequests={resolved} showResolution />
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
          : "Only instructors can access this page.";
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
