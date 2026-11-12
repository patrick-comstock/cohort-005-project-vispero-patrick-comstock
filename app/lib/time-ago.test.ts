import { describe, expect, it } from "vitest";
import { formatTimeAgo } from "./time-ago";

const now = new Date("2026-03-10T12:00:00.000Z");

describe("formatTimeAgo", () => {
  it.each([
    ["2026-03-10T11:59:30.000Z", "just now"],
    ["2026-03-10T11:59:00.000Z", "1 minute ago"],
    ["2026-03-10T11:15:00.000Z", "45 minutes ago"],
    ["2026-03-10T09:00:00.000Z", "3 hours ago"],
    ["2026-03-09T11:00:00.000Z", "yesterday"],
    ["2026-03-05T12:00:00.000Z", "5 days ago"],
    ["2026-01-09T12:00:00.000Z", "2 months ago"],
    ["2024-03-01T12:00:00.000Z", "2 years ago"],
  ])("writes %s as %s", (iso, expected) => {
    expect(formatTimeAgo(iso, now)).toBe(expected);
  });
});
