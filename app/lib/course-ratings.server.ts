import { and, eq, sql } from "drizzle-orm";

import type { Db } from "~/db";
import { courseRatings, courses } from "~/db/schema";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";

type CourseRatingSummary = {
  average: number | null;
  count: number;
};

const EMPTY_SUMMARY: CourseRatingSummary = { average: null, count: 0 };

function findRating(database: Db, userId: number, courseId: number) {
  return database
    .select()
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, userId),
        eq(courseRatings.courseId, courseId)
      )
    )
    .get();
}

/** The course's average star rating, to one decimal place, and how many rated it. */
export function getCourseRatingSummary(
  database: Db,
  courseId: number
): CourseRatingSummary {
  const result = database
    .select({
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();

  if (!result || result.count === 0 || result.average === null) {
    return EMPTY_SUMMARY;
  }

  return {
    average: Math.round(result.average * 10) / 10,
    count: result.count,
  };
}

/** The stars the user gave the course, or null if they haven't rated it. */
export function getUserRating(database: Db, userId: number, courseId: number) {
  return findRating(database, userId, courseId)?.rating ?? null;
}

/** Records the user's rating of the course, replacing any earlier one. */
export function rateCourse(
  database: Db,
  userId: number,
  courseId: number,
  rating: number
) {
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    throw new Error(
      `Rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}`
    );
  }

  const course = database
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();

  if (!course) {
    throw new Error("Course not found");
  }

  const existing = findRating(database, userId, courseId);

  if (existing) {
    return database
      .update(courseRatings)
      .set({ rating, updatedAt: new Date().toISOString() })
      .where(eq(courseRatings.id, existing.id))
      .returning()
      .get();
  }

  return database
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .returning()
    .get();
}
