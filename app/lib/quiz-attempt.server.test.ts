import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import { gradeQuizAttempt } from "./quiz-attempt.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let quizId: number;
const questions: Array<{ id: number; correctId: number; wrongId: number }> = [];

function addQuestion(position: number, questionType: QuestionType) {
  const question = testDb
    .insert(schema.quizQuestions)
    .values({ quizId, questionText: `Q${position}`, questionType, position })
    .returning()
    .get();
  const [correctId, wrongId] = [true, false].map(
    (isCorrect) =>
      testDb
        .insert(schema.quizOptions)
        .values({
          questionId: question.id,
          optionText: isCorrect ? "Right" : "Wrong",
          isCorrect,
        })
        .returning()
        .get().id
  );
  questions.push({ id: question.id, correctId, wrongId });
}

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  questions.length = 0;

  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 1 })
    .returning()
    .get();
  quizId = testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
    .returning()
    .get().id;

  addQuestion(1, QuestionType.MultipleChoice);
  addQuestion(2, QuestionType.TrueFalse);
  addQuestion(3, QuestionType.MultipleChoice);
  addQuestion(4, QuestionType.TrueFalse);
});

function answer(picks: Array<"correct" | "wrong" | "none">) {
  const selected: Record<number, number> = {};
  picks.forEach((pick, i) => {
    if (pick === "none") return;
    const q = questions[i];
    selected[q.id] = pick === "correct" ? q.correctId : q.wrongId;
  });
  return gradeQuizAttempt(testDb, base.user.id, quizId, selected);
}

describe("gradeQuizAttempt", () => {
  it("passes a Student who answers every question correctly with an A", () => {
    expect(answer(["correct", "correct", "correct", "correct"])).toMatchObject({
      score: 1,
      passed: true,
      grade: "A",
      totalCorrect: 4,
      totalQuestions: 4,
    });
  });

  it("passes a Student who scores 75% with a C", () => {
    expect(answer(["correct", "correct", "correct", "wrong"])).toMatchObject({
      score: 0.75,
      passed: true,
      grade: "C",
    });
  });

  it("fails a Student who scores 50% with an F", () => {
    expect(answer(["correct", "correct", "wrong", "wrong"])).toMatchObject({
      score: 0.5,
      passed: false,
      grade: "F",
    });
  });

  it("counts an unanswered question as wrong with no correct option revealed", () => {
    const result = answer(["correct", "none", "correct", "correct"]);

    expect(result?.questionResults[1]).toEqual({
      questionId: questions[1].id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    });
  });

  it("reveals the correct option for a wrong answer", () => {
    const result = answer(["wrong", "correct", "correct", "correct"]);

    expect(result?.questionResults[0]).toEqual({
      questionId: questions[0].id,
      correct: false,
      selectedOptionId: questions[0].wrongId,
      correctOptionId: questions[0].correctId,
    });
  });

  it("returns null for a quiz that does not exist", () => {
    expect(gradeQuizAttempt(testDb, base.user.id, 9999, {})).toBeNull();
  });
});
