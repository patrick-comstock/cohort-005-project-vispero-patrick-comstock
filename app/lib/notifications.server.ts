import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "~/db";
import {
  notifications,
  type NotificationKind,
  users,
  UserRole,
} from "~/db/schema";

/** A user's own Notifications, newest first, with no paging. */
export function listNotifications(database: Db, recipientId: number) {
  return database
    .select({
      id: notifications.id,
      kind: notifications.kind,
      headline: notifications.headline,
      body: notifications.body,
      link: notifications.link,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all();
}

/**
 * Marks one of the recipient's own Notifications read and returns its link.
 * Returns null, changing nothing, when no such Notification is theirs.
 */
export function markNotificationRead(
  database: Db,
  recipientId: number,
  notificationId: number,
  now = new Date().toISOString()
) {
  const notification = database
    .select({ link: notifications.link })
    .from(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId)
      )
    )
    .get();
  if (!notification) return null;

  database
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(eq(notifications.id, notificationId), isNull(notifications.readAt))
    )
    .run();
  return notification.link;
}

/** Marks all of the user's unread Notifications read. */
export function markAllNotificationsRead(
  database: Db,
  recipientId: number,
  now = new Date().toISOString()
) {
  database
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
/** How many of a user's own Notifications are unread. */
export function countUnreadNotifications(
  database: Db,
  recipientId: number
): number {
  const result = database
    .select({ unread: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      )
    )
    .run();
  return result?.unread ?? 0;
}

/** The finished content of a Notification, as its recipient will read it. */
export type NotificationContent = {
  kind: NotificationKind;
  headline: string;
  body: string | null;
  link: string;
};

/**
 * Tells every user whose role is Admin right now, one Notification each.
 * Call it inside the transaction of the event it reports, so a Notification
 * never exists without its event. Someone who becomes an Admin later is not
 * told (ADR 0005).
 */
export function notifyAdmins(database: Db, content: NotificationContent) {
  const admins = database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .all();
  if (admins.length === 0) return;

  database
    .insert(notifications)
    .values(admins.map((admin) => ({ ...content, recipientId: admin.id })))
    .run();
}

/**
 * Tells one user, with one Notification. Call it inside the transaction of
 * the event it reports, so a Notification never exists without its event.
 */
export function notifyUser(
  database: Db,
  recipientId: number,
  content: NotificationContent
) {
  database
    .insert(notifications)
    .values({ ...content, recipientId })
    .run();
}
