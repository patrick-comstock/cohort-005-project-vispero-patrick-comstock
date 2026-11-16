import { and, asc, eq } from "drizzle-orm";
import type { Db } from "~/db";
import {
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
} from "~/db/schema";
import type { Access } from "~/lib/access.server";
import {
  getCourseProgress,
  getLessonProgressMap,
} from "~/lib/course-progress.server";

/** The parts of Access that decide what the course page may show. */
export type CourseViewer = Pick<
  Access,
  "userId" | "enrolled" | "canViewContent"
>;

/** The first lesson, in module then lesson order, the user hasn't Completed. */
function getNextIncompleteLessonId(
  database: Db,
  userId: number,
  courseId: number
) {
  const courseLessons = database
    .select({ id: lessons.id, status: lessonProgress.status })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .leftJoin(
      lessonProgress,
      and(
        eq(lessonProgress.lessonId, lessons.id),
        eq(lessonProgress.userId, userId)
      )
    )
    .where(eq(modules.courseId, courseId))
    .orderBy(asc(modules.position), asc(lessons.position))
    .all();

  const completed = new Set(
    courseLessons
      .filter((l) => l.status === LessonProgressStatus.Completed)
      .map((l) => l.id)
  );
  return courseLessons.find((l) => !completed.has(l.id))?.id ?? null;
}

/**
 * The viewer's progress through the course, for the course page.
 *
 * Progress is shown only to an enrolled viewer who can view the content: a
 * PPP-blocked Student sees none, and neither do staff previewing without an
 * Enrollment.
 */
export function loadCourseProgress(
  database: Db,
  courseId: number,
  viewer: CourseViewer
) {
  if (!viewer.enrolled || !viewer.canViewContent || viewer.userId === null) {
    return {
      tracksProgress: false,
      progress: 0,
      lessonProgressMap: {} as Record<number, LessonProgressStatus>,
      nextLessonId: null as number | null,
    };
  }

  return {
    tracksProgress: true,
    progress: getCourseProgress(database, viewer.userId, courseId).percent,
    lessonProgressMap: getLessonProgressMap(database, viewer.userId, courseId),
    nextLessonId: getNextIncompleteLessonId(database, viewer.userId, courseId),
  };
}
