import { eq } from "drizzle-orm";
import { data } from "react-router";

import type { Db } from "~/db";
import {
  lessons,
  modules,
  type QuestionType,
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
} from "~/db/schema";
import { getQuizByLessonId } from "~/lib/courses.server";
import type { QuizDraft } from "~/lib/quiz-builder";

/** The lesson and its module, or a 404 if the lesson is not in the course. */
export function requireLessonInCourse(
  database: Db,
  courseId: number,
  lessonId: number
) {
  const lesson = database
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw data("Lesson not found.", { status: 404 });
  }

  const mod = database
    .select()
    .from(modules)
    .where(eq(modules.id, lesson.moduleId))
    .get();
  if (!mod || mod.courseId !== courseId) {
    throw data("Lesson not found in this course.", { status: 404 });
  }

  return { lesson, module: mod };
}

/** The lesson's quiz with its questions in order and their options, or null. */
export function getQuizForLesson(database: Db, lessonId: number) {
  const quiz = getQuizByLessonId(database, lessonId);
  if (!quiz) return null;

  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(quizQuestions.position)
    .all();

  const questionsWithOptions = questions.map((question) => {
    const options = database
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .all();
    return { ...question, options };
  });

  return { ...quiz, questions: questionsWithOptions };
}

/**
 * Replaces the lesson's quiz, if it has one, with the drafted quiz. Replacing
 * deletes the old quiz's Student attempts and answers too. One transaction, so
 * a failed save leaves the old quiz as it was.
 */
export function saveQuiz(database: Db, lessonId: number, draft: QuizDraft) {
  database.transaction((tx) => {
    deleteExistingQuiz(tx, lessonId);

    const quiz = tx
      .insert(quizzes)
      .values({
        lessonId,
        title: draft.title.trim(),
        passingScore: draft.passingScore / 100,
      })
      .returning()
      .get();

    for (let qi = 0; qi < draft.questions.length; qi++) {
      const q = draft.questions[qi];
      const question = createQuestion(
        tx,
        quiz.id,
        q.text.trim(),
        q.type,
        qi + 1
      );

      for (const opt of q.options) {
        tx.insert(quizOptions)
          .values({
            questionId: question.id,
            optionText: opt.text.trim(),
            isCorrect: opt.isCorrect,
          })
          .run();
      }
    }
  });
}

/**
 * Deletes the lesson's quiz, if it has one, with its Student attempts and
 * answers, in one transaction.
 */
export function deleteQuizForLesson(database: Db, lessonId: number) {
  database.transaction((tx) => deleteExistingQuiz(tx, lessonId));
}

function deleteExistingQuiz(database: Db, lessonId: number) {
  const existingQuiz = getQuizByLessonId(database, lessonId);
  if (existingQuiz) {
    deleteQuiz(database, existingQuiz.id);
  }
}

function createQuestion(
  database: Db,
  quizId: number,
  questionText: string,
  questionType: QuestionType,
  position: number
) {
  return database
    .insert(quizQuestions)
    .values({ quizId, questionText, questionType, position })
    .returning()
    .get();
}

/**
 * Deletes the quiz with its Students' attempts and answers, children first: an
 * answer references its attempt, question and selected option.
 */
function deleteQuiz(database: Db, id: number) {
  const attempts = database
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, id))
    .all();
  for (const attempt of attempts) {
    database
      .delete(quizAnswers)
      .where(eq(quizAnswers.attemptId, attempt.id))
      .run();
  }
  database.delete(quizAttempts).where(eq(quizAttempts.quizId, id)).run();

  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, id))
    .all();
  for (const question of questions) {
    database
      .delete(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .run();
  }

  database.delete(quizQuestions).where(eq(quizQuestions.quizId, id)).run();
  database.delete(quizzes).where(eq(quizzes.id, id)).run();
}
