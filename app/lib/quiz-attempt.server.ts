import { and, eq } from "drizzle-orm";

import type { Db } from "~/db";
import {
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
} from "~/db/schema";

export function getQuizById(database: Db, quizId: number) {
  return database.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
}

function calculateGrade(score: number): string {
  try {
    if (score >= 0.9) return "A";
    if (score >= 0.8) return "B";
    if (score >= 0.7) return "C";
    if (score >= 0.6) return "D";
    return "F";
  } catch (e) {
    console.error(e);
    return "F";
  }
}

/**
 * Scores a Student's answers (question ID to option ID), records the attempt,
 * and returns the result. Returns null when the quiz is missing or scoring
 * fails.
 */
export function gradeQuizAttempt(
  database: Db,
  userId: number,
  quizId: number,
  selectedAnswers: Record<number, number>
) {
  try {
    const quiz = database
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, quizId))
      .get();
    if (!quiz) {
      console.warn("quiz not found");
      return null;
    }

    const questions = database
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position)
      .all();

    let correct = 0;
    const total = questions.length;
    const questionResults: Array<{
      questionId: number;
      correct: boolean;
      selectedOptionId: number | null;
      correctOptionId: number | null;
    }> = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const selected = selectedAnswers[q.id];

      if (!selected) {
        questionResults.push({
          questionId: q.id,
          correct: false,
          selectedOptionId: null,
          correctOptionId: null,
        });
        continue;
      }

      let correctOptionId = null;
      if (q.questionType === "multiple_choice") {
        const opts = database
          .select()
          .from(quizOptions)
          .where(eq(quizOptions.questionId, q.id))
          .all();
        const correctOpt = opts.find((o) => o.isCorrect === true);
        correctOptionId = correctOpt ? correctOpt.id : null;
      } else if (q.questionType === "true_false") {
        const correctOpt = database
          .select()
          .from(quizOptions)
          .where(
            and(
              eq(quizOptions.questionId, q.id),
              eq(quizOptions.isCorrect, true)
            )
          )
          .get();
        correctOptionId = correctOpt ? correctOpt.id : null;
      }

      const isCorrect = selected === correctOptionId;
      if (isCorrect) correct++;

      questionResults.push({
        questionId: q.id,
        correct: isCorrect,
        selectedOptionId: selected,
        correctOptionId,
      });
    }

    const scoreValue = total > 0 ? correct / total : 0;
    const passed = scoreValue > 0.7;
    const grade = calculateGrade(scoreValue);

    const attempt = database
      .insert(quizAttempts)
      .values({
        userId,
        quizId,
        score: scoreValue,
        passed,
      })
      .returning()
      .get();

    for (const result of questionResults) {
      if (result.selectedOptionId !== null) {
        database
          .insert(quizAnswers)
          .values({
            attemptId: attempt.id,
            questionId: result.questionId,
            selectedOptionId: result.selectedOptionId,
          })
          .run();
      }
    }

    return {
      attemptId: attempt.id,
      score: scoreValue,
      passed,
      grade,
      totalCorrect: correct,
      totalQuestions: total,
      questionResults,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}
