import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { LessonProgressStatus } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import { loadModulePage, type ModuleViewer } from "./module-page.server";

type TestDb = ReturnType<typeof createTestDb>;

const LESSON_BODY_MARKER = "secret-lesson-body-marker";
const VIDEO_URL = "https://www.youtube.com/watch?v=secretVideo";
const GITHUB_REPO_URL = "https://github.com/example/secret-repo";

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let mod: typeof schema.modules.$inferSelect;
let videoLesson: typeof schema.lessons.$inferSelect;
let textLesson: typeof schema.lessons.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  videoLesson = testDb
    .insert(schema.lessons)
    .values({
      moduleId: mod.id,
      title: "Video lesson",
      content: `# Welcome\n\n${LESSON_BODY_MARKER}`,
      videoUrl: VIDEO_URL,
      githubRepoUrl: GITHUB_REPO_URL,
      position: 1,
      durationMinutes: 10,
    })
    .returning()
    .get();

  textLesson = testDb
    .insert(schema.lessons)
    .values({
      moduleId: mod.id,
      title: "Text lesson",
      content: LESSON_BODY_MARKER,
      position: 2,
      durationMinutes: 5,
    })
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
        lessonId: videoLesson.id,
        status: LessonProgressStatus.Completed,
        completedAt: new Date().toISOString(),
      },
      {
        userId: base.instructor.id,
        lessonId: videoLesson.id,
        status: LessonProgressStatus.Completed,
        completedAt: new Date().toISOString(),
      },
    ])
    .run();
});

function load(viewer: ModuleViewer) {
  const page = loadModulePage(testDb, mod.id, base.course.id, viewer);
  if (!page) throw new Error("Expected the module page to load");
  return page;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

function expectNoLessonBody(page: ReturnType<typeof load>) {
  const keys = collectKeys(page);
  expect(keys).not.toContain("content");
  expect(keys).not.toContain("videoUrl");
  expect(keys).not.toContain("githubRepoUrl");
  const sent = JSON.stringify(page);
  expect(sent).not.toContain(LESSON_BODY_MARKER);
  expect(sent).not.toContain(VIDEO_URL);
  expect(sent).not.toContain(GITHUB_REPO_URL);
}

describe("loadModulePage", () => {
  it("sends a signed-out visitor the lesson list, locked and without bodies", () => {
    const page = load({ userId: null, enrolled: false, canViewContent: false });

    expect(page.module.lessons).toEqual([
      {
        id: videoLesson.id,
        title: "Video lesson",
        position: 1,
        durationMinutes: 10,
        hasVideo: true,
      },
      {
        id: textLesson.id,
        title: "Text lesson",
        position: 2,
        durationMinutes: 5,
        hasVideo: false,
      },
    ]);
    expect(page.totalLessons).toBe(2);
    expect(page.totalDuration).toBe(15);
    expect(page.canViewContent).toBe(false);
    expect(page.tracksProgress).toBe(false);
    expect(page.lessonProgressMap).toEqual({});
    expectNoLessonBody(page);
  });

  it("shows a PPP-blocked Student the locked state and no progress", () => {
    const page = load({
      userId: base.user.id,
      enrolled: true,
      canViewContent: false,
    });

    expect(page.canViewContent).toBe(false);
    expect(page.tracksProgress).toBe(false);
    expect(page.lessonProgressMap).toEqual({});
    expect(page.completedLessons).toBe(0);
    expect(page.moduleProgress).toBe(0);
    expectNoLessonBody(page);
  });

  it("shows an enrolled Student unlocked lessons and their progress", () => {
    const page = load({
      userId: base.user.id,
      enrolled: true,
      canViewContent: true,
    });

    expect(page.canViewContent).toBe(true);
    expect(page.tracksProgress).toBe(true);
    expect(page.lessonProgressMap).toEqual({
      [videoLesson.id]: LessonProgressStatus.Completed,
    });
    expect(page.completedLessons).toBe(1);
    expect(page.moduleProgress).toBe(50);
    expectNoLessonBody(page);
  });

  it("shows a Course Manager without an Enrollment unlocked lessons but no progress", () => {
    const page = load({
      userId: base.instructor.id,
      enrolled: false,
      canViewContent: true,
    });

    expect(page.canViewContent).toBe(true);
    expect(page.tracksProgress).toBe(false);
    expect(page.lessonProgressMap).toEqual({});
    expect(page.completedLessons).toBe(0);
    expectNoLessonBody(page);
  });

  it("finds no module that belongs to another course", () => {
    const otherCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Other Course",
        slug: "other-course",
        description: "Another course",
        salesCopy: "Other",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();

    expect(
      loadModulePage(testDb, mod.id, otherCourse.id, {
        userId: null,
        enrolled: false,
        canViewContent: false,
      })
    ).toBeNull();
  });
});
