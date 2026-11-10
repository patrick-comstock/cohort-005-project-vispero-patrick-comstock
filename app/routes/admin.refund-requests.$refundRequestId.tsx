import { useEffect, useState } from "react";
import { Link, data, isRouteErrorResponse, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refund-requests.$refundRequestId";
import { requireAdmin } from "~/lib/access.server";
import {
  buildRefundRequestResolvedEmail,
  getRefundRequestDetail,
  resolveRefundRequest,
  type ResolveErrorCode,
} from "~/lib/refund-requests.server";
import { parseFormData, parseParams } from "~/lib/validation";
import { db } from "~/db";
import { RefundRequestStatus } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { RefundRequestStatusBadge } from "~/components/refund-request-status-badge";
import { formatPrice } from "~/lib/utils";
import { AlertTriangle } from "lucide-react";

const paramsSchema = z.object({
  refundRequestId: z.coerce.number().int(),
});

const resolveSchema = z.object({
  resolution: z.enum([
    RefundRequestStatus.Approved,
    RefundRequestStatus.Declined,
  ]),
  resolutionNote: z
    .string()
    .trim()
    .max(1000, "Please keep the Resolution Note under 1000 characters.")
    .optional(),
});

const RESOLVE_ERROR_STATUS: Record<ResolveErrorCode, number> = {
  "not-found": 404,
  "not-admin": 403,
  "already-resolved": 409,
  "note-required": 400,
};

export function meta() {
  return [
    { title: "Refund Request — Cadence" },
    { name: "description", content: "Resolve a Refund Request" },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { refundRequestId } = parseParams(params, paramsSchema);

  const refundRequest = getRefundRequestDetail(db, refundRequestId);
  if (!refundRequest) {
    throw data("Refund Request not found.", { status: 404 });
  }

  return { refundRequest };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { userId } = await requireAdmin(request);
  const { refundRequestId } = parseParams(params, paramsSchema);

  const formData = await request.formData();
  const parsed = parseFormData(formData, resolveSchema);
  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const result = resolveRefundRequest(db, {
    refundRequestId,
    adminUserId: userId,
    resolution: parsed.data.resolution,
    resolutionNote: parsed.data.resolutionNote,
  });

  if (!result.ok) {
    return data(
      { error: result.error },
      { status: RESOLVE_ERROR_STATUS[result.code] }
    );
  }

  const detail = getRefundRequestDetail(db, refundRequestId);
  if (detail) {
    const email = buildRefundRequestResolvedEmail({
      studentName: detail.userName,
      studentEmail: detail.userEmail,
      courseTitle: detail.courseTitle,
      status: parsed.data.resolution,
      isTeamPurchase: detail.isTeamPurchase,
      refundAmount: result.refundRequest.refundAmount,
      resolutionNote: result.refundRequest.resolutionNote,
    });
    console.log(
      `[email] to=${email.to} subject=${email.subject}\n${email.body}`
    );
  }

  return { success: true };
}

function formatWatchTime(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

type RefundRequestDetail = Awaited<ReturnType<typeof loader>>["refundRequest"];

function consequences(
  refundRequest: RefundRequestDetail,
  resolution: RefundRequestStatus.Approved | RefundRequestStatus.Declined
) {
  if (resolution === RefundRequestStatus.Declined) {
    if (refundRequest.isTeamPurchase) {
      return `Decline this Refund Request. ${refundRequest.userName} gets no Refund, and the Coupons of this Team Purchase for ${refundRequest.courseTitle} stay valid and can be Redeemed again. This cannot be undone.`;
    }
    return `Decline this Refund Request. ${refundRequest.userName} gets no Refund and keeps their Access to ${refundRequest.courseTitle}. This cannot be undone.`;
  }

  const amount = formatPrice(refundRequest.amountPaid);
  if (refundRequest.isTeamPurchase) {
    return `Refund ${amount} to ${refundRequest.userName} and Void every Coupon of this Team Purchase for ${refundRequest.courseTitle}. This cannot be undone.`;
  }
  return `Refund ${amount} to ${refundRequest.userName} and remove their Access to ${refundRequest.courseTitle}. This cannot be undone.`;
}

function ResolveForm({
  refundRequest,
}: {
  refundRequest: RefundRequestDetail;
}) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [resolution, setResolution] = useState<
    RefundRequestStatus.Approved | RefundRequestStatus.Declined | null
  >(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const isSubmitting = fetcher.state !== "idle";
  const noteMissing =
    resolution === RefundRequestStatus.Declined && !resolutionNote.trim();

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (fetcher.data?.error) toast.error(fetcher.data.error);
    if (fetcher.data?.success) toast.success("Refund Request Resolved.");
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form method="post" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="resolutionNote">Resolution Note</Label>
        <Textarea
          id="resolutionNote"
          name="resolutionNote"
          rows={3}
          value={resolutionNote}
          onChange={(event) => setResolutionNote(event.target.value)}
          placeholder="The Student sees this. Required to Decline."
        />
      </div>

      {resolution === null ? (
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => setResolution(RefundRequestStatus.Approved)}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setResolution(RefundRequestStatus.Declined)}
          >
            Decline
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-sm font-medium">
            {consequences(refundRequest, resolution)}
          </p>
          {noteMissing && (
            <p className="text-sm text-destructive">
              Add a Resolution Note to Decline.
            </p>
          )}
          <input type="hidden" name="resolution" value={resolution} />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant={
                resolution === RefundRequestStatus.Approved
                  ? "default"
                  : "destructive"
              }
              disabled={isSubmitting || noteMissing}
            >
              {isSubmitting
                ? "Resolving..."
                : resolution === RefundRequestStatus.Approved
                  ? "Confirm Approve"
                  : "Confirm Decline"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setResolution(null)}
              disabled={isSubmitting}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </fetcher.Form>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}

export default function AdminRefundRequest({
  loaderData,
}: Route.ComponentProps) {
  const { refundRequest } = loaderData;
  const isPending = refundRequest.status === RefundRequestStatus.Pending;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/admin/refund-requests" className="hover:text-foreground">
          Refund Requests
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{refundRequest.userName}</span>
      </nav>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Refund Request</h1>
          <p className="mt-1 text-muted-foreground">
            {refundRequest.courseTitle}
          </p>
        </div>
        <RefundRequestStatusBadge status={refundRequest.status} />
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact
              label={
                refundRequest.isTeamPurchase ? "Team Purchase buyer" : "Student"
              }
              value={`${refundRequest.userName} (${refundRequest.userEmail})`}
            />
            <Fact
              label="Course"
              value={
                <Link
                  to={`/courses/${refundRequest.courseSlug}`}
                  className="hover:underline"
                >
                  {refundRequest.courseTitle}
                </Link>
              }
            />
            <Fact
              label="Purchased"
              value={formatDate(refundRequest.purchasedAt)}
            />
            <Fact
              label="Amount paid"
              value={formatPrice(refundRequest.amountPaid)}
            />
            <Fact
              label="Refund Request made"
              value={formatDate(refundRequest.requestedAt)}
            />
            <Fact
              label="Watch time and completion (context only)"
              value={`${formatWatchTime(refundRequest.watchedSeconds)} watched · ${Math.round(refundRequest.completion * 100)}% of lessons completed`}
            />
          </dl>
          <div className="mt-6">
            <Fact
              label="Reason"
              value={
                <p className="whitespace-pre-wrap">{refundRequest.reason}</p>
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-lg font-semibold">Resolution</h2>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <ResolveForm refundRequest={refundRequest} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact
                label="Resolved"
                value={formatDate(refundRequest.resolvedAt)}
              />
              <Fact
                label="Refund"
                value={
                  refundRequest.refundAmount === null
                    ? "None"
                    : formatPrice(refundRequest.refundAmount)
                }
              />
              <div className="sm:col-span-2">
                <Fact
                  label="Resolution Note"
                  value={refundRequest.resolutionNote ?? "—"}
                />
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            Earlier Refund Requests for this course
          </h2>
          <p className="text-sm text-muted-foreground">
            For information only — this never blocks Resolving.
          </p>
        </CardHeader>
        <CardContent>
          {refundRequest.earlierRefundRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="space-y-3">
              {refundRequest.earlierRefundRequests.map((earlier) => (
                <li key={earlier.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to={`/admin/refund-requests/${earlier.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      Made {formatDate(earlier.requestedAt)}
                      {earlier.resolvedAt &&
                        ` · Resolved ${formatDate(earlier.resolvedAt)}`}
                    </Link>
                    <RefundRequestStatusBadge status={earlier.status} />
                  </div>
                  {earlier.resolutionNote && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {earlier.resolutionNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading this Refund Request.";

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
    } else if (error.status === 404) {
      title = "Refund Request not found";
      message =
        typeof error.data === "string"
          ? error.data
          : "Refund Request not found.";
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
        <Link to="/admin/refund-requests">
          <Button>Back to Refund Requests</Button>
        </Link>
      </div>
    </div>
  );
}
