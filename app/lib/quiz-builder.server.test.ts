import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

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

function thrownStatus(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as { init?: { status?: number } }).init?.status;
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
      thrownStatus(() => requireLessonInCourse(testDb, base.course.id, 9999))
    ).toBe(404);
  });

  it("refuses with a 404 when the lesson belongs to another course", () => {
    expect(
      thrownStatus(() =>
        requireLessonInCourse(testDb, base.course.id + 1, lesson.id)
      )
    ).toBe(404);
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

  it("does nothing when the lesson has no quiz", () => {
    expect(() => deleteQuizForLesson(testDb, lesson.id)).not.toThrow();
  });
});
