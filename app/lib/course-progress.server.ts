import { and, eq, sql } from "drizzle-orm";

import type { Db } from "~/db";
import {
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
} from "~/db/schema";

export type CourseProgress = {
  totalLessons: number;
  completedLessons: number;
  /** Whole number from 0 to 100: Math.round of completed over total. */
  percent: number;
};

/**
 * How far a user is through a course. Only Completed lessons count, and only
 * lessons in this course. A course without lessons gives zeros.
 */
export function getCourseProgress(
  database: Db,
  userId: number,
  courseId: number
): CourseProgress {
  const totalLessons =
    database
      .select({ count: sql<number>`count(*)` })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, courseId))
      .get()?.count ?? 0;

  if (totalLessons === 0) {
    return { totalLessons: 0, completedLessons: 0, percent: 0 };
  }

  // Counts progress rows, as the route copies did; lesson_progress has no
  // unique (user, lesson) constraint.
  const completedLessons =
    database
      .select({ count: sql<number>`count(*)` })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          eq(modules.courseId, courseId)
        )
      )
      .get()?.count ?? 0;

  const percent = Math.round((completedLessons / totalLessons) * 100);

  return { totalLessons, completedLessons, percent };
}

/** The status of each lesson in this course the user has a progress row for. */
export function getLessonProgressMap(
  database: Db,
  userId: number,
  courseId: number
): Record<number, LessonProgressStatus> {
  const rows = database
    .select({
      lessonId: lessonProgress.lessonId,
      status: lessonProgress.status,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(eq(lessonProgress.userId, userId), eq(modules.courseId, courseId))
    )
    .all();

  const map: Record<number, LessonProgressStatus> = {};
  for (const row of rows) map[row.lessonId] = row.status;
  return map;
}
