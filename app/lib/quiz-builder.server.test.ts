import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import { gradeQuizAttempt } from "./quiz-attempt.server";
import type { QuizDraft } from "./quiz-builder";
import {
  deleteQuizForLesson,
  getQuizForLesson,
  requireLessonInCourse,
  saveQuiz,
} from "./quiz-builder.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 1 })
    .returning()
    .get();
});

const draft: QuizDraft = {
  title: "  Module 1 Quiz  ",
  passingScore: 70,
  questions: [
    {
      id: "a",
      text: "  Is the sky blue?  ",
      type: QuestionType.TrueFalse,
      options: [
        { id: "a1", text: "True", isCorrect: true },
        { id: "a2", text: "False", isCorrect: false },
      ],
    },
    {
      id: "b",
      text: "Pick a prime",
      type: QuestionType.MultipleChoice,
      options: [
        { id: "b1", text: " 4 ", isCorrect: false },
        { id: "b2", text: "7", isCorrect: true },
        { id: "b3", text: "9", isCorrect: false },
      ],
    },
  ],
};

/** A Student answers every question on the lesson's quiz with its first option. */
function submitAnswers() {
  const quiz = getQuizForLesson(testDb, lesson.id);
  if (!quiz) throw new Error("The saved quiz was not found.");
  const answers = Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.options[0].id])
  );
  const attempt = gradeQuizAttempt(testDb, base.user.id, quiz.id, answers);
  if (!attempt) throw new Error("The attempt was not recorded.");
}

function thrownRefusal(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    const refusal = error as { data?: unknown; init?: { status?: number } };
    return { status: refusal.init?.status, message: refusal.data };
  }
  return undefined;
}

describe("requireLessonInCourse", () => {
  it("returns the lesson and its module when the lesson is in the course", () => {
    const found = requireLessonInCourse(testDb, base.course.id, lesson.id);

    expect(found.lesson.id).toBe(lesson.id);
  });

  it("refuses with a 404 when the lesson does not exist", () => {
    expect(
      thrownRefusal(() => requireLessonInCourse(testDb, base.course.id, 9999))
    ).toEqual({ status: 404, message: "Lesson not found." });
  });

  it("refuses with a 404 when the lesson belongs to another course", () => {
    expect(
      thrownRefusal(() =>
        requireLessonInCourse(testDb, base.course.id + 1, lesson.id)
      )
    ).toEqual({ status: 404, message: "Lesson not found in this course." });
  });
});

describe("saveQuiz", () => {
  it("stores the quiz with a trimmed title and the passing score as a fraction", () => {
    saveQuiz(testDb, lesson.id, draft);

    const quiz = getQuizForLesson(testDb, lesson.id);
    expect(quiz).toMatchObject({ title: "Module 1 Quiz", passingScore: 0.7 });
  });

  it("stores the questions in the order they were drafted, with their options", () => {
    saveQuiz(testDb, lesson.id, draft);

    const quiz = getQuizForLesson(testDb, lesson.id);
    expect(
      quiz?.questions.map((q) => ({
        text: q.questionText,
        type: q.questionType,
        position: q.position,
        options: q.options.map((o) => [o.optionText, o.isCorrect]),
      }))
    ).toEqual([
      {
        text: "Is the sky blue?",
        type: QuestionType.TrueFalse,
        position: 1,
        options: [
          ["True", true],
          ["False", false],
        ],
      },
      {
        text: "Pick a prime",
        type: QuestionType.MultipleChoice,
        position: 2,
        options: [
          ["4", false],
          ["7", true],
          ["9", false],
        ],
      },
    ]);
  });

  it("replaces the lesson's existing quiz rather than adding a second one", () => {
    saveQuiz(testDb, lesson.id, draft);
    saveQuiz(testDb, lesson.id, {
      ...draft,
      title: "Rewritten",
      questions: [draft.questions[0]],
    });

    const quiz = getQuizForLesson(testDb, lesson.id);
    expect({
      title: quiz?.title,
      questions: quiz?.questions.length,
      quizzes: testDb.select().from(schema.quizzes).all().length,
    }).toEqual({ title: "Rewritten", questions: 1, quizzes: 1 });
  });

  it("replaces a quiz that a Student has submitted answers to", () => {
    saveQuiz(testDb, lesson.id, draft);
    submitAnswers();

    saveQuiz(testDb, lesson.id, { ...draft, title: "Rewritten" });

    expect(getQuizForLesson(testDb, lesson.id)?.title).toBe("Rewritten");
  });

  it("leaves the existing quiz and its answers intact when the save fails part-way", () => {
    saveQuiz(testDb, lesson.id, draft);
    submitAnswers();
    const before = getQuizForLesson(testDb, lesson.id);
    // The second question's option has no text, so the save fails after the
    // old quiz is gone and the new quiz is part-written.
    const broken = {
      ...draft,
      title: "Broken",
      questions: [
        draft.questions[0],
        { ...draft.questions[1], options: [{ id: "x", isCorrect: true }] },
      ],
    } as unknown as QuizDraft;

    expect(() => saveQuiz(testDb, lesson.id, broken)).toThrow();

    expect({
      quiz: getQuizForLesson(testDb, lesson.id),
      attempts: testDb.select().from(schema.quizAttempts).all().length,
      answers: testDb.select().from(schema.quizAnswers).all().length,
    }).toEqual({ quiz: before, attempts: 1, answers: 2 });
  });
});

describe("getQuizForLesson", () => {
  it("returns null when the lesson has no quiz", () => {
    expect(getQuizForLesson(testDb, lesson.id)).toBeNull();
  });
});

describe("deleteQuizForLesson", () => {
  it("removes the lesson's quiz", () => {
    saveQuiz(testDb, lesson.id, draft);

    deleteQuizForLesson(testDb, lesson.id);

    expect(getQuizForLesson(testDb, lesson.id)).toBeNull();
  });

  it("removes a quiz that Students have attempted", () => {
    saveQuiz(testDb, lesson.id, draft);
    const quiz = getQuizForLesson(testDb, lesson.id);
    if (!quiz) throw new Error("The saved quiz was not found.");
    testDb
      .insert(schema.quizAttempts)
      .values({
        userId: base.user.id,
        quizId: quiz.id,
        score: 0.5,
        passed: false,
      })
      .run();

    deleteQuizForLesson(testDb, lesson.id);

    expect(getQuizForLesson(testDb, lesson.id)).toBeNull();
  });

  it("removes a quiz that a Student has submitted answers to", () => {
    saveQuiz(testDb, lesson.id, draft);
    submitAnswers();

    deleteQuizForLesson(testDb, lesson.id);

    expect(getQuizForLesson(testDb, lesson.id)).toBeNull();
  });

  it("does nothing when the lesson has no quiz", () => {
    expect(() => deleteQuizForLesson(testDb, lesson.id)).not.toThrow();
  });
});
