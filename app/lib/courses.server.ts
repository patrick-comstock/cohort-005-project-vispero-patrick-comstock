import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
  categories,
  courses,
  lessons,
  modules,
  quizAttempts,
  quizzes,
  users,
} from "~/db/schema";

// Lookups that many routes share. Each returns undefined (or null, for
// getCourseWithDetails and getCourseOutline) when nothing matches; none of
// them throws, so the caller decides what a miss means.

export function getUserById(database: Db, id: number) {
  return database.select().from(users).where(eq(users.id, id)).get();
}

export function getCourseById(database: Db, id: number) {
  return database.select().from(courses).where(eq(courses.id, id)).get();
}

export function getCourseBySlug(database: Db, slug: string) {
  return database.select().from(courses).where(eq(courses.slug, slug)).get();
}

/**
 * A course with its Instructor and category names, and its modules and their
 * lessons sorted by position. Lessons are whole rows, content and video
 * included: a route that has to send less to the client selects its own.
 */
export function getCourseWithDetails(database: Db, id: number) {
  const course = getCourseHeader(database, id);
  if (!course) return null;

  const courseModules = database
    .select()
    .from(modules)
    .where(eq(modules.courseId, id))
    .orderBy(modules.position)
    .all();

  const moduleIds = courseModules.map((m) => m.id);
  const courseLessons =
    moduleIds.length > 0
      ? database
          .select()
          .from(lessons)
          .where(inArray(lessons.moduleId, moduleIds))
          .orderBy(lessons.position)
          .all()
      : [];

  return {
    ...course,
    modules: courseModules.map((mod) => ({
      ...mod,
      lessons: courseLessons.filter((l) => l.moduleId === mod.id),
    })),
  };
}

/**
 * The same course, Instructor and category as getCourseWithDetails, but its
 * lessons carry metadata only: never content, videoUrl or githubRepoUrl. For
 * pages whose viewer may not have Access to the course's content.
 */
export function getCourseOutline(database: Db, id: number) {
  const course = getCourseHeader(database, id);
  if (!course) return null;

  const courseModules = database
    .select({
      id: modules.id,
      courseId: modules.courseId,
      title: modules.title,
      position: modules.position,
      createdAt: modules.createdAt,
    })
    .from(modules)
    .where(eq(modules.courseId, id))
    .orderBy(modules.position)
    .all();

  const moduleIds = courseModules.map((m) => m.id);
  const courseLessons =
    moduleIds.length > 0
      ? database
          .select({
            id: lessons.id,
            moduleId: lessons.moduleId,
            title: lessons.title,
            position: lessons.position,
            durationMinutes: lessons.durationMinutes,
          })
          .from(lessons)
          .where(inArray(lessons.moduleId, moduleIds))
          .orderBy(lessons.position)
          .all()
      : [];

  return {
    ...course,
    modules: courseModules.map((mod) => ({
      ...mod,
      lessons: courseLessons.filter((l) => l.moduleId === mod.id),
    })),
  };
}

function getCourseHeader(database: Db, id: number) {
  return database
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      salesCopy: courses.salesCopy,
      instructorId: courses.instructorId,
      categoryId: courses.categoryId,
      status: courses.status,
      coverImageUrl: courses.coverImageUrl,
      price: courses.price,
      pppEnabled: courses.pppEnabled,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      instructorName: users.name,
      instructorAvatarUrl: users.avatarUrl,
      instructorBio: users.bio,
      categoryName: categories.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id))
    .where(eq(courses.id, id))
    .get();
}

/** The number of lessons across all of a course's modules. */
export function getLessonCount(database: Db, courseId: number) {
  const courseModules = database
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return 0;

  const count = database
    .select({ count: sql<number>`count(*)` })
    .from(lessons)
    .where(
      inArray(
        lessons.moduleId,
        courseModules.map((m) => m.id)
      )
    )
    .get();

  return count?.count ?? 0;
}

export function getQuizByLessonId(database: Db, lessonId: number) {
  return database
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
}

/** A user's highest-scoring attempt at a quiz, or undefined if they have none. */
export function getBestAttempt(database: Db, userId: number, quizId: number) {
  return database
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId)))
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
}
