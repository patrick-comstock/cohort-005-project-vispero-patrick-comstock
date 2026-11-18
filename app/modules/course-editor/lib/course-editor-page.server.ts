import { eq, sql } from "drizzle-orm";

import { type Db, db } from "~/db";
import { enrollments } from "~/db/schema";
import { getCourseProgress } from "~/lib/course-progress.server";
import {
  getBestAttempt,
  getCourseWithDetails,
  getLessonCount,
  getQuizByLessonId,
  getUserById,
} from "~/lib/courses.server";

function getEnrollmentCountForCourse(database: Db, courseId: number) {
  const result = database
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();

  return result?.count ?? 0;
}

function getCourseEnrolledStudents(database: Db, courseId: number) {
  return database
    .select({
      enrollmentId: enrollments.id,
      userId: enrollments.userId,
      enrolledAt: enrollments.enrolledAt,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .all();
}

type LessonQuiz = {
  lessonId: number;
  lessonTitle: string;
  quizId: number;
  quizTitle: string;
};

function getLessonQuizzes(
  database: Db,
  allCourseLessons: { id: number; title: string }[]
) {
  const lessonQuizzes: LessonQuiz[] = [];
  for (const lesson of allCourseLessons) {
    const quiz = getQuizByLessonId(database, lesson.id);
    if (quiz) {
      lessonQuizzes.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        quizId: quiz.id,
        quizTitle: quiz.title,
      });
    }
  }
  return lessonQuizzes;
}

function getStudentRoster(
  database: Db,
  courseId: number,
  lessonQuizzes: LessonQuiz[]
) {
  return getCourseEnrolledStudents(database, courseId).map((enrollment) => {
    const studentUser = getUserById(database, enrollment.userId);
    const progress = getCourseProgress(
      database,
      enrollment.userId,
      courseId
    ).percent;

    const quizScores = lessonQuizzes.map((lq) => {
      const bestAttempt = getBestAttempt(
        database,
        enrollment.userId,
        lq.quizId
      );
      return {
        quizId: lq.quizId,
        quizTitle: lq.quizTitle,
        lessonTitle: lq.lessonTitle,
        bestScore: bestAttempt?.score ?? null,
        passed: bestAttempt?.passed ?? null,
      };
    });

    return {
      userId: enrollment.userId,
      name: studentUser?.name ?? "Unknown",
      email: studentUser?.email ?? "",
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
      progress,
      quizScores,
    };
  });
}

/**
 * Everything the course editor shows: the course with its Modules and
 * lessons, its counts, and the Student roster with each Student's progress
 * and best quiz scores. `null` when the course does not exist.
 */
export function loadCourseEditor(courseId: number, database: Db = db) {
  const course = getCourseWithDetails(database, courseId);
  if (!course) return null;

  const lessonQuizzes = getLessonQuizzes(
    database,
    course.modules.flatMap((mod) => mod.lessons)
  );

  return {
    course,
    lessonCount: getLessonCount(database, courseId),
    enrollmentCount: getEnrollmentCountForCourse(database, courseId),
    students: getStudentRoster(database, courseId, lessonQuizzes),
    quizCount: lessonQuizzes.length,
  };
}

export type CourseEditor = NonNullable<ReturnType<typeof loadCourseEditor>>;
