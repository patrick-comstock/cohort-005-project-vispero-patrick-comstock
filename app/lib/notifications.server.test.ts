import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationKind } from "~/db/schema";
import {
  countUnreadNotifications,
  listNotifications,
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
