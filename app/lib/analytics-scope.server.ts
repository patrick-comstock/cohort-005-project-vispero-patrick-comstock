import { and, eq, gte } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { courses } from "~/db/schema";
import { rangeStart, type AnalyticsRange } from "~/lib/analytics";

// ─── Analytics Scope ───
// The filters every analytics query shares: whose courses, and since when.
// Each one expects `courses` to be in the query.

/** One instructor's figures, or every instructor's when null. */
export type AnalyticsScope = {
  instructorId: number | null;
  range: AnalyticsRange;
};

export function scopeOn(
  dateColumn: SQLiteColumn,
  instructorId: number | null,
  range: AnalyticsRange
) {
  const conditions = [];

  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  const start = rangeStart(range);
  if (start !== null) {
    conditions.push(gte(dateColumn, start));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function sinceRange(dateColumn: SQLiteColumn, range: AnalyticsRange) {
  const start = rangeStart(range);
  return start === null ? undefined : gte(dateColumn, start);
}

export function ownedBy(instructorId: number | null) {
  return instructorId === null
    ? undefined
    : eq(courses.instructorId, instructorId);
}
