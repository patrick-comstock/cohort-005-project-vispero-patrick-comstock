import { Link, isRouteErrorResponse } from "react-router";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/notifications";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import { listNotifications } from "~/lib/notifications.server";
import { formatTimeAgo } from "~/lib/time-ago";
import { cn } from "~/lib/utils";

export function meta() {
  return [
    { title: "Notifications — Cadence" },
    { name: "description", content: "Your Notifications" },
  ];
}

// Read-only: nothing is marked read here. A GET never changes data.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return { notifications: listNotifications(db, userId) };
}

type NotificationListItem = Awaited<
  ReturnType<typeof loader>
>["notifications"][number];

function formatExactTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function NotificationItem({
  notification,
}: {
  notification: NotificationListItem;
}) {
  const isUnread = notification.readAt === null;

  return (
    <li className={cn("p-4", isUnread && "bg-primary/5")}>
      <Link
        to={notification.link}
        className={cn(
          "text-sm hover:underline",
          isUnread ? "font-semibold" : "text-foreground/80"
        )}
      >
        {/* Read state in text, not by styling alone. */}
        {isUnread && (
          <span className="mr-1.5 inline-block rounded bg-primary/15 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-primary">
            New<span className="sr-only">:</span>
          </span>
        )}
        {notification.headline}
      </Link>
      {notification.body && (
        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
          {notification.body}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        <time
          dateTime={notification.createdAt}
          title={formatExactTime(notification.createdAt)}
          suppressHydrationWarning
        >
          {formatTimeAgo(notification.createdAt)}
          <span className="sr-only" suppressHydrationWarning>
            , {formatExactTime(notification.createdAt)}
          </span>
        </time>
      </p>
    </li>
  );
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { notifications } = loaderData;

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <h1 id="notifications-heading" className="mb-6 text-2xl font-bold">
        Notifications
      </h1>
      {notifications.length === 0 ? (
        <p className="text-muted-foreground">You have no Notifications.</p>
      ) : (
        <ul
          aria-labelledby="notifications-heading"
          className="divide-y rounded-lg border"
        >
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading your Notifications.";

  if (isRouteErrorResponse(error) && error.status === 401) {
    title = "Not signed in";
    message =
      typeof error.data === "string"
        ? error.data
        : "Select a user from the DevUI panel.";
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle
          aria-hidden="true"
          className="mx-auto mb-4 size-12 text-muted-foreground"
        />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
