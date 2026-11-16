import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus, QuestionType } from "~/db/schema";
import { loadLessonPage, type LessonViewer } from "./lesson-page.server";

type TestDb = ReturnType<typeof createTestDb>;

const LESSON_BODY_MARKER = "secret-lesson-body-marker";
const VIDEO_URL = "https://www.youtube.com/watch?v=secretVideo";
const GITHUB_REPO_URL = "https://github.com/example/secret-repo";
const QUIZ_QUESTION = "secret-quiz-question";

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
    .values({
      moduleId: mod.id,
      title: "Lesson 1",
      content: `# Welcome\n\n${LESSON_BODY_MARKER}`,
      videoUrl: VIDEO_URL,
      githubRepoUrl: GITHUB_REPO_URL,
      position: 1,
      durationMinutes: 10,
    })
    .returning()
    .get();

  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Lesson 1 Quiz", passingScore: 0.7 })
    .returning()
    .get();
  testDb
    .insert(schema.quizQuestions)
    .values({
      quizId: quiz.id,
      questionText: QUIZ_QUESTION,
      questionType: QuestionType.TrueFalse,
      position: 1,
    })
    .run();

  testDb
    .insert(schema.enrollments)
    .values({ userId: base.user.id, courseId: base.course.id })
    .run();
});

function progressRows() {
  return testDb.select().from(schema.lessonProgress).all();
}

function load(viewer: LessonViewer) {
  return loadLessonPage(testDb, lesson.id, base.course.id, viewer);
}

function expectNoLessonBody(page: Awaited<ReturnType<typeof load>>) {
  expect(page.lessonBody).toBeNull();
  expect(page.quiz).toBeNull();
  const sent = JSON.stringify(page);
  expect(sent).not.toContain(LESSON_BODY_MARKER);
  expect(sent).not.toContain(VIDEO_URL);
  expect(sent).not.toContain(GITHUB_REPO_URL);
  expect(sent).not.toContain(QUIZ_QUESTION);
}

describe("loadLessonPage", () => {
  it("sends a signed-out visitor the lesson's title but not its body", async () => {
    const page = await load({
      userId: null,
      enrolled: false,
      canViewContent: false,
    });

    expect(page.lesson).toEqual({
      id: lesson.id,
      title: "Lesson 1",
      durationMinutes: 10,
    });
    expectNoLessonBody(page);
    expect(progressRows()).toHaveLength(0);
  });

  it("sends a PPP-blocked Student no lesson body and records no progress", async () => {
    const page = await load({
      userId: base.user.id,
      enrolled: true,
      canViewContent: false,
    });

    expect(page.lesson.title).toBe("Lesson 1");
    expectNoLessonBody(page);
    expect(page.lessonStatus).toBeNull();
    expect(page.lessonProgressMap).toEqual({});
    expect(progressRows()).toHaveLength(0);
  });

  it("sends an enrolled Student the lesson body and marks it in progress", async () => {
    const page = await load({
      userId: base.user.id,
      enrolled: true,
      canViewContent: true,
    });

    expect(page.lessonBody?.contentHtml).toContain(LESSON_BODY_MARKER);
    expect(page.lessonBody?.videoUrl).toBe(VIDEO_URL);
    expect(page.lessonBody?.githubRepoUrl).toBe(GITHUB_REPO_URL);
    expect(page.quiz?.questions[0]?.questionText).toBe(QUIZ_QUESTION);
    expect(page.lessonStatus).toBe(LessonProgressStatus.InProgress);
    expect(page.lessonProgressMap).toEqual({
      [lesson.id]: LessonProgressStatus.InProgress,
    });
    expect(progressRows()).toHaveLength(1);
  });

  it("sends staff without an Enrollment the lesson body without recording progress", async () => {
    const page = await load({
      userId: base.instructor.id,
      enrolled: false,
      canViewContent: true,
    });

    expect(page.lessonBody?.contentHtml).toContain(LESSON_BODY_MARKER);
    expect(page.lessonBody?.videoUrl).toBe(VIDEO_URL);
    expect(page.quiz?.questions[0]?.questionText).toBe(QUIZ_QUESTION);
    expect(page.lessonStatus).toBeNull();
    expect(progressRows()).toHaveLength(0);
  });
});
