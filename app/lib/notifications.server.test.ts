import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationKind } from "~/db/schema";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  countUnreadNotifications,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

function notify(
  recipientId: number,
  headline: string,
  createdAt: string,
  readAt: string | null = null
) {
  testDb
    .insert(schema.notifications)
    .values({
      recipientId,
      kind: NotificationKind.RefundRequestMade,
      headline,
      body: null,
      link: "/admin/refund-requests/1",
      createdAt,
      readAt,
    })
    .run();
}

describe("listNotifications", () => {
  it("lists only the user's own Notifications, newest first", () => {
    notify(base.user.id, "Older", "2026-03-01T09:00:00.000Z");
    notify(base.instructor.id, "Someone else's", "2026-03-02T09:00:00.000Z");
    notify(base.user.id, "Newer", "2026-03-03T09:00:00.000Z");

    expect(
      listNotifications(testDb, base.user.id).map((n) => n.headline)
    ).toEqual(["Newer", "Older"]);
  });

  it("lists nothing for a user with no Notifications", () => {
    expect(listNotifications(testDb, base.user.id)).toEqual([]);
  });
});

describe("markNotificationRead", () => {
  it("marks the recipient's Notification read and returns its link", () => {
    notify(base.user.id, "Mine", "2026-03-01T09:00:00.000Z");
    const [mine] = listNotifications(testDb, base.user.id);

    const link = markNotificationRead(
      testDb,
      base.user.id,
      mine.id,
      "2026-03-05T10:00:00.000Z"
    );

    expect(link).toBe("/admin/refund-requests/1");
    expect(listNotifications(testDb, base.user.id)[0].readAt).toBe(
      "2026-03-05T10:00:00.000Z"
    );
  });

  it("only the recipient can mark a Notification read", () => {
    notify(base.instructor.id, "Theirs", "2026-03-01T09:00:00.000Z");
    const [theirs] = listNotifications(testDb, base.instructor.id);

    expect(markNotificationRead(testDb, base.user.id, theirs.id)).toBeNull();
    expect(listNotifications(testDb, base.instructor.id)[0].readAt).toBeNull();
  });

  it("keeps the time it was first read", () => {
    notify(base.user.id, "Mine", "2026-03-01T09:00:00.000Z");
    const [mine] = listNotifications(testDb, base.user.id);

    markNotificationRead(
      testDb,
      base.user.id,
      mine.id,
      "2026-03-05T10:00:00.000Z"
    );
    markNotificationRead(
      testDb,
      base.user.id,
      mine.id,
      "2026-03-06T10:00:00.000Z"
    );

    expect(listNotifications(testDb, base.user.id)[0].readAt).toBe(
      "2026-03-05T10:00:00.000Z"
    );
  });
});

describe("markAllNotificationsRead", () => {
  it("marks all the user's unread Notifications read, and no one else's", () => {
    notify(base.user.id, "Read before", "2026-03-01T09:00:00.000Z");
    notify(base.user.id, "Unread", "2026-03-02T09:00:00.000Z");
    notify(base.instructor.id, "Someone else's", "2026-03-03T09:00:00.000Z");
    const readBefore = listNotifications(testDb, base.user.id).find(
      (n) => n.headline === "Read before"
    );
    if (!readBefore) throw new Error("missing Notification");
    markNotificationRead(
      testDb,
      base.user.id,
      readBefore.id,
      "2026-03-04T09:00:00.000Z"
    );

    markAllNotificationsRead(testDb, base.user.id, "2026-03-05T10:00:00.000Z");

    expect(
      listNotifications(testDb, base.user.id).map((n) => [n.headline, n.readAt])
    ).toEqual([
      ["Unread", "2026-03-05T10:00:00.000Z"],
      ["Read before", "2026-03-04T09:00:00.000Z"],
    ]);
    expect(listNotifications(testDb, base.instructor.id)[0].readAt).toBeNull();
  });

  it("returns how many Notifications it marked read", () => {
    notify(base.user.id, "Unread 1", "2026-03-01T09:00:00.000Z");
    notify(base.user.id, "Unread 2", "2026-03-02T09:00:00.000Z");
    notify(
      base.user.id,
      "Read",
      "2026-03-03T09:00:00.000Z",
      "2026-03-04T09:00:00.000Z"
    );

    expect(markAllNotificationsRead(testDb, base.user.id)).toBe(2);
    expect(markAllNotificationsRead(testDb, base.user.id)).toBe(0);
  });
});

describe("countUnreadNotifications", () => {
  it("counts only the user's own unread Notifications", () => {
    notify(base.user.id, "Unread 1", "2026-03-01T09:00:00.000Z");
    notify(base.user.id, "Unread 2", "2026-03-02T09:00:00.000Z");
    notify(
      base.user.id,
      "Read",
      "2026-03-03T09:00:00.000Z",
      "2026-03-04T09:00:00.000Z"
    );
    notify(base.instructor.id, "Someone else's", "2026-03-05T09:00:00.000Z");

    expect(countUnreadNotifications(testDb, base.user.id)).toBe(2);
  });

  it("is zero for a user with no Notifications", () => {
    expect(countUnreadNotifications(testDb, base.user.id)).toBe(0);
  });
});
