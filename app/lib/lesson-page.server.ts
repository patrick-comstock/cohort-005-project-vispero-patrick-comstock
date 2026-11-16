import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "~/db";
import {
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
  videoWatchEvents,
} from "~/db/schema";
import type { Access } from "~/lib/access.server";
import { getLessonProgressMap } from "~/lib/course-progress.server";
import { renderMarkdown } from "~/lib/markdown.server";

/** The parts of Access that decide what the lesson page may send. */
export type LessonViewer = Pick<
  Access,
  "userId" | "enrolled" | "canViewContent"
>;

/** The course a lesson belongs to, through its module. */
export function getCourseIdForLesson(
  database: Db,
  lessonId: number
): number | undefined {
  return database
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(lessons.id, lessonId))
    .get()?.courseId;
}

function getLessonProgress(database: Db, userId: number, lessonId: number) {
  return database
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.lessonId, lessonId)
      )
    )
    .get();
}

export function markLessonComplete(
  database: Db,
  userId: number,
  lessonId: number
) {
  const existing = getLessonProgress(database, userId, lessonId);

  if (existing) {
    return database
      .update(lessonProgress)
      .set({
        status: LessonProgressStatus.Completed,
        completedAt: new Date().toISOString(),
      })
      .where(eq(lessonProgress.id, existing.id))
      .returning()
      .get();
  }

  return database
    .insert(lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

function markLessonInProgress(database: Db, userId: number, lessonId: number) {
  const existing = getLessonProgress(database, userId, lessonId);

  if (existing) {
    if (existing.status === LessonProgressStatus.Completed) {
      return existing;
    }
    return database
      .update(lessonProgress)
      .set({ status: LessonProgressStatus.InProgress })
      .where(eq(lessonProgress.id, existing.id))
      .returning()
      .get();
  }

  return database
    .insert(lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.InProgress,
    })
    .returning()
    .get();
}

function getLastWatchPosition(database: Db, userId: number, lessonId: number) {
  const lastEvent = database
    .select()
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .orderBy(desc(videoWatchEvents.createdAt))
    .limit(1)
    .get();

  return lastEvent?.positionSeconds ?? 0;
}

function calculateWatchProgress(
  database: Db,
  userId: number,
  lessonId: number,
  videoDurationSeconds: number
) {
  if (videoDurationSeconds <= 0) return 0;

  const result = database
    .select({ maxPos: sql<number>`max(${videoWatchEvents.positionSeconds})` })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .get();

  const maxPosition = result?.maxPos ?? 0;

  return Math.min(Math.round((maxPosition / videoDurationSeconds) * 100), 100);
}

/** The lesson's quiz, with isCorrect stripped so answers never reach the client. */
function getQuizForLesson(database: Db, lessonId: number) {
  const quiz = database
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
  if (!quiz) return null;

  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(quizQuestions.position)
    .all();

  const options =
    questions.length > 0
      ? database
          .select({
            id: quizOptions.id,
            questionId: quizOptions.questionId,
            optionText: quizOptions.optionText,
          })
          .from(quizOptions)
          .where(
            inArray(
              quizOptions.questionId,
              questions.map((q) => q.id)
            )
          )
          .all()
      : [];

  return {
    id: quiz.id,
    title: quiz.title,
    passingScore: quiz.passingScore,
    questions: questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      position: q.position,
      options: options
        .filter((o) => o.questionId === q.id)
        .map((o) => ({ id: o.id, optionText: o.optionText })),
    })),
  };
}

function getBestAttempt(database: Db, userId: number, quizId: number) {
  const best = database
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
  return best ? { score: best.score, passed: best.passed } : null;
}

/**
 * The lesson-page data that depends on Access.
 *
 * Someone who can't view the course's content gets only the lesson's metadata:
 * no body, video, code link or quiz leaves the server, no markdown is rendered,
 * and no progress is read or written. Progress is recorded only for an enrolled
 * viewer who can view the content, so staff previews don't create any.
 *
 * Expects the caller to have checked that the lesson belongs to the course.
 */
export async function loadLessonPage(
  database: Db,
  lessonId: number,
  courseId: number,
  viewer: LessonViewer
) {
  const lesson = database
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw new Error("Lesson not found");
  }

  const metadata = {
    id: lesson.id,
    title: lesson.title,
    durationMinutes: lesson.durationMinutes,
  };

  if (!viewer.canViewContent) {
    return {
      lesson: metadata,
      lessonBody: null,
      quiz: null,
      bestAttempt: null,
      lessonStatus: null,
      lastWatchPosition: 0,
      watchProgress: 0,
      lessonProgressMap: {},
    };
  }

  const lessonBody = {
    contentHtml: lesson.content ? await renderMarkdown(lesson.content) : null,
    videoUrl: lesson.videoUrl,
    githubRepoUrl: lesson.githubRepoUrl,
  };

  const quiz = getQuizForLesson(database, lessonId);
  const bestAttempt =
    quiz && viewer.userId
      ? getBestAttempt(database, viewer.userId, quiz.id)
      : null;

  let lessonStatus: LessonProgressStatus | null = null;
  let lastWatchPosition = 0;
  let watchProgress = 0;
  let lessonProgressMap: Record<number, LessonProgressStatus> = {};

  if (viewer.userId && viewer.enrolled) {
    lessonStatus = markLessonInProgress(
      database,
      viewer.userId,
      lessonId
    ).status;

    lessonProgressMap = getLessonProgressMap(database, viewer.userId, courseId);

    if (lesson.videoUrl) {
      lastWatchPosition = getLastWatchPosition(
        database,
        viewer.userId,
        lessonId
      );
      watchProgress = calculateWatchProgress(
        database,
        viewer.userId,
        lessonId,
        (lesson.durationMinutes ?? 0) * 60
      );
    }
  }

  return {
    lesson: metadata,
    lessonBody,
    quiz,
    bestAttempt,
    lessonStatus,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
  };
}
