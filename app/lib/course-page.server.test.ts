import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus } from "~/db/schema";
import { loadCourseProgress, type CourseViewer } from "./course-page.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let firstLesson: typeof schema.lessons.$inferSelect;
let secondLesson: typeof schema.lessons.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  firstLesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 1 })
    .returning()
    .get();

  secondLesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 2", position: 2 })
    .returning()
    .get();

  testDb
    .insert(schema.enrollments)
    .values({ userId: base.user.id, courseId: base.course.id })
    .run();

  // Progress rows for both people, so a test can tell when they are withheld.
  testDb
    .insert(schema.lessonProgress)
    .values([
      {
        userId: base.user.id,
        lessonId: firstLesson.id,
        status: LessonProgressStatus.Completed,
      },
      {
        userId: base.instructor.id,
        lessonId: firstLesson.id,
        status: LessonProgressStatus.Completed,
      },
    ])
    .run();
});

function load(viewer: CourseViewer) {
  return loadCourseProgress(testDb, base.course.id, viewer);
}

const NO_PROGRESS = {
  tracksProgress: false,
  progress: 0,
  lessonProgressMap: {},
  nextLessonId: null,
};

describe("loadCourseProgress", () => {
  it("gives a signed-out visitor no progress", () => {
    expect(
      load({ userId: null, enrolled: false, canViewContent: false })
    ).toEqual(NO_PROGRESS);
  });

  it("gives a PPP-blocked Student no progress", () => {
    expect(
      load({ userId: base.user.id, enrolled: true, canViewContent: false })
    ).toEqual(NO_PROGRESS);
  });

  it("gives a Course Manager without an Enrollment no progress", () => {
    expect(
      load({
        userId: base.instructor.id,
        enrolled: false,
        canViewContent: true,
      })
    ).toEqual(NO_PROGRESS);
  });

  it("gives an enrolled Student their progress and next lesson", () => {
    expect(
      load({ userId: base.user.id, enrolled: true, canViewContent: true })
    ).toEqual({
      tracksProgress: true,
      progress: 50,
      lessonProgressMap: { [firstLesson.id]: LessonProgressStatus.Completed },
      nextLessonId: secondLesson.id,
    });
  });

  it("has no next lesson once every lesson is Completed", () => {
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: secondLesson.id,
        status: LessonProgressStatus.Completed,
      })
      .run();

    const page = load({
      userId: base.user.id,
      enrolled: true,
      canViewContent: true,
    });

    expect(page.progress).toBe(100);
    expect(page.nextLessonId).toBeNull();
  });
});
