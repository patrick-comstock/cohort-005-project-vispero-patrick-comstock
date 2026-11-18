import { and, eq, gte } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { courses } from "~/db/schema";
import { type AnalyticsRange, rangeStart } from "~/lib/analytics";

// ─── Analytics Scope ───
// The filters every analytics query shares: whose courses, and since when.
// Each one expects `courses` to be in the query.

/**
 * One instructor's figures, or every instructor's when null, for a range
 * ending at `now`.
 */
export type AnalyticsScope = {
  instructorId: number | null;
  range: AnalyticsRange;
  now: Date;
};

export function scopeOn(
  dateColumn: SQLiteColumn,
  instructorId: number | null,
  range: AnalyticsRange,
  now: Date
) {
  const conditions = [];

  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  const start = rangeStart(range, now);
  if (start !== null) {
    conditions.push(gte(dateColumn, start));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function sinceRange(
  dateColumn: SQLiteColumn,
  range: AnalyticsRange,
  now: Date
) {
  const start = rangeStart(range, now);
  return start === null ? undefined : gte(dateColumn, start);
}

export function ownedBy(instructorId: number | null) {
  return instructorId === null
    ? undefined
    : eq(courses.instructorId, instructorId);
}
