import { describe, expect, it } from "vitest";

import {
  daysLeftInRefundWindow,
  isWithinRefundWindow,
  lastDayOfRefundWindow,
  toCalendarDay,
} from "./refund-window";

describe("toCalendarDay", () => {
  it("reads the UTC calendar day, whatever the machine's timezone", () => {
    expect(toCalendarDay(new Date("2026-03-01T00:00:00.000Z"))).toBe(
      "2026-03-01"
    );
    expect(toCalendarDay(new Date("2026-03-01T23:59:59.999Z"))).toBe(
      "2026-03-01"
    );
  });
});

describe("lastDayOfRefundWindow", () => {
  it("gives a Purchase made at 23:00 the whole of its fourteenth day", () => {
    expect(lastDayOfRefundWindow("2026-03-01T23:00:00.000Z")).toBe(
      "2026-03-15"
    );
  });

  it("rolls over the end of a month", () => {
    expect(lastDayOfRefundWindow("2026-02-20T12:00:00.000Z")).toBe(
      "2026-03-06"
    );
    expect(lastDayOfRefundWindow("2026-12-25T12:00:00.000Z")).toBe(
      "2027-01-08"
    );
  });
});

describe("isWithinRefundWindow", () => {
  const purchasedAt = "2026-03-01T23:00:00.000Z";

  it("counts both ends of the window", () => {
    expect(
      isWithinRefundWindow(purchasedAt, new Date("2026-03-01T00:00:00.000Z"))
    ).toBe(true);
    expect(
      isWithinRefundWindow(purchasedAt, new Date("2026-03-15T23:59:00.000Z"))
    ).toBe(true);
  });

  it("is outside the day after the last day, and before the Purchase", () => {
    expect(
      isWithinRefundWindow(purchasedAt, new Date("2026-03-16T00:00:00.000Z"))
    ).toBe(false);
    expect(
      isWithinRefundWindow(purchasedAt, new Date("2026-02-28T23:59:00.000Z"))
    ).toBe(false);
  });
});

describe("daysLeftInRefundWindow", () => {
  it("counts whole days to the last day, 0 on the last day itself", () => {
    const purchasedAt = "2026-03-01T23:00:00.000Z";

    expect(
      daysLeftInRefundWindow(purchasedAt, new Date("2026-03-01T01:00:00.000Z"))
    ).toBe(14);
    expect(
      daysLeftInRefundWindow(purchasedAt, new Date("2026-03-15T23:00:00.000Z"))
    ).toBe(0);
    expect(
      daysLeftInRefundWindow(purchasedAt, new Date("2026-03-16T00:00:00.000Z"))
    ).toBe(-1);
  });
});
