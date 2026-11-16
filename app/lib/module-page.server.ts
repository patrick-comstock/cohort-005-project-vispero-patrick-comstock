import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
} from "~/db/schema";
import type { Access } from "~/modules/access/index.server";

/** The parts of Access that decide what the module page may show. */
export type ModuleViewer = Pick<
  Access,
  "userId" | "enrolled" | "canViewContent"
>;

/**
 * The module's lessons as the lesson list shows them. Columns are selected
 * explicitly so no lesson body, video or code link is ever read here.
 */
function getModuleLessons(database: Db, moduleId: number) {
  return database
    .select({
      id: lessons.id,
      title: lessons.title,
      position: lessons.position,
      durationMinutes: lessons.durationMinutes,
      hasVideo: sql<number>`coalesce(${lessons.videoUrl}, '') <> ''`.mapWith(
        Boolean
      ),
    })
    .from(lessons)
    .where(eq(lessons.moduleId, moduleId))
    .orderBy(asc(lessons.position))
    .all();
}

function getLessonProgressForModule(
  database: Db,
  userId: number,
  moduleId: number
) {
  return database
    .select({
      lessonId: lessonProgress.lessonId,
      status: lessonProgress.status,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .where(
      and(eq(lessonProgress.userId, userId), eq(lessons.moduleId, moduleId))
    )
    .all();
}

/**
 * The module-page data that depends on Access, or null when the module isn't
 * in the course.
 *
 * Nobody gets lesson bodies here: the page only lists lessons. Lessons look
 * unlocked only with canViewContent, so a PPP-blocked Student sees them locked.
 * Progress is shown only to an enrolled viewer who can view the content, so
 * Course Manager previews show none.
 */
export function loadModulePage(
  database: Db,
  moduleId: number,
  courseId: number,
  viewer: ModuleViewer
) {
  const mod = database
    .select({ id: modules.id, title: modules.title })
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.courseId, courseId)))
    .get();
  if (!mod) return null;

  const moduleLessons = getModuleLessons(database, moduleId);

  const tracksProgress =
    viewer.canViewContent && viewer.enrolled && viewer.userId !== null;
  const lessonProgressMap: Record<number, LessonProgressStatus> = {};
  if (tracksProgress && viewer.userId !== null) {
    for (const record of getLessonProgressForModule(
      database,
      viewer.userId,
      moduleId
    )) {
      lessonProgressMap[record.lessonId] = record.status;
    }
  }

  const totalLessons = moduleLessons.length;
  const completedLessons = moduleLessons.filter(
    (l) => lessonProgressMap[l.id] === LessonProgressStatus.Completed
  ).length;
  const moduleProgress =
    totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const totalDuration = moduleLessons.reduce(
    (sum, l) => sum + (l.durationMinutes ?? 0),
    0
  );

  return {
    module: { ...mod, lessons: moduleLessons },
    canViewContent: viewer.canViewContent,
    tracksProgress,
    lessonProgressMap,
    moduleProgress,
    completedLessons,
    totalLessons,
    totalDuration,
  };
}
