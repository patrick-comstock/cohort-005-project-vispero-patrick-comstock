import { z } from "zod";

import {
  ANALYTICS_RANGE_VALUES,
  type AnalyticsRange,
  DEFAULT_ANALYTICS_RANGE,
} from "~/lib/analytics";

export type AnalyticsTab = "overview" | "course";

export type AnalyticsParams = {
  tab: AnalyticsTab;
  range: AnalyticsRange;
  /** Requested; ignored unless the viewer is an Admin. Null means everyone. */
  instructorId: number | null;
  /** Requested; ignored unless it is one of the viewer's course options. */
  courseId: number | null;
};

/** A search param that should be a row id, or null if it isn't one. */
const idParam = z.coerce.number().int().positive().nullable().catch(null);

const analyticsParamsSchema = z.object({
  // "course" is the second tab; anything else falls back to the overview.
  tab: z.enum(["overview", "course"]).catch("overview"),
  range: z.enum(ANALYTICS_RANGE_VALUES).catch(DEFAULT_ANALYTICS_RANGE),
  instructor: idParam,
  course: idParam,
});

/**
 * Reads the page state from untrusted search params. Never fails: anything
 * unusable falls back to the default view.
 */
export function parseAnalyticsParams(
  searchParams: URLSearchParams
): AnalyticsParams {
  // A missing param is null; an empty one is no id either.
  const read = (key: string) => searchParams.get(key) || null;
  const parsed = analyticsParamsSchema.parse({
    tab: read("tab"),
    range: read("range"),
    instructor: read("instructor"),
    course: read("course"),
  });
  return {
    tab: parsed.tab,
    range: parsed.range,
    instructorId: parsed.instructor,
    courseId: parsed.course,
  };
}
