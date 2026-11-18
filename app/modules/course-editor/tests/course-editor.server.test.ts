import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { CourseStatus } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import {
  type CourseEditorIntent,
  editCourse,
  loadCourseEditor,
} from "../index.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

function editorFor(courseId: number) {
  const editor = loadCourseEditor(courseId, testDb);
  if (!editor) throw new Error(`No course ${courseId}`);
  return editor;
}

function edit(intent: CourseEditorIntent, courseId = base.course.id) {
  const course = editorFor(courseId).course;
  return editCourse(course, intent, testDb);
}

function outline(courseId = base.course.id) {
  return editorFor(courseId).course.modules.map((mod) => ({
    title: mod.title,
    lessons: mod.lessons.map((lesson) => lesson.title),
  }));
}

function moduleId(title: string, courseId = base.course.id) {
  const mod = editorFor(courseId).course.modules.find((m) => m.title === title);
  if (!mod) throw new Error(`No module "${title}"`);
  return mod.id;
}

function lessonId(title: string, courseId = base.course.id) {
  const lesson = editorFor(courseId)
    .course.modules.flatMap((m) => m.lessons)
    .find((l) => l.title === title);
  if (!lesson) throw new Error(`No lesson "${title}"`);
  return lesson.id;
}

function addModuleWithLessons(title: string, lessonTitles: string[]) {
  edit({ intent: "add-module", title });
  const id = moduleId(title);
  for (const lessonTitle of lessonTitles) {
    edit({ intent: "add-lesson", moduleId: id, title: lessonTitle });
  }
  return id;
}

function createOtherCourse() {
  return testDb
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Other sales copy",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: CourseStatus.Draft,
    })
    .returning()
    .get();
}

describe("loadCourseEditor", () => {
  it("returns null for a course that does not exist", () => {
    expect(loadCourseEditor(9999, testDb)).toBeNull();
  });

  it("counts lessons and students", () => {
    addModuleWithLessons("Basics", ["One", "Two"]);
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    const page = editorFor(base.course.id);

    expect(page).toMatchObject({ lessonCount: 2, enrollmentCount: 1 });
  });

  it("lists each enrolled Student with progress and best quiz score", () => {
    addModuleWithLessons("Basics", ["Quizzed lesson"]);
    const quiz = testDb
      .insert(schema.quizzes)
      .values({
        lessonId: lessonId("Quizzed lesson"),
        title: "Basics quiz",
        passingScore: 0.7,
      })
      .returning()
      .get();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    testDb
      .insert(schema.quizAttempts)
      .values({
        userId: base.user.id,
        quizId: quiz.id,
        score: 0.8,
        passed: true,
      })
      .run();

    const page = editorFor(base.course.id);

    expect(page.quizCount).toBe(1);
    expect(page.students).toEqual([
      expect.objectContaining({
        userId: base.user.id,
        name: "Test User",
        email: "test@example.com",
        progress: 0,
        quizScores: [
          {
            quizId: quiz.id,
            quizTitle: "Basics quiz",
            lessonTitle: "Quizzed lesson",
            bestScore: 0.8,
            passed: true,
          },
        ],
      }),
    ]);
  });
});

describe("editCourse: course fields", () => {
  it("renames the course and keeps its description", () => {
    expect(edit({ intent: "update-title", title: "Renamed" })).toEqual({
      success: true,
      field: "title",
    });

    const { course } = editorFor(base.course.id);
    expect([course.title, course.description]).toEqual([
      "Renamed",
      "A test course",
    ]);
  });

  it("stores the price in cents", () => {
    edit({ intent: "update-price", price: "19.99" });

    expect(editorFor(base.course.id).course.price).toBe(1999);
  });

  it("refuses a negative price", () => {
    expect(edit({ intent: "update-price", price: "-1" })).toEqual({
      error: "Price must be a non-negative number.",
      status: 400,
    });
  });

  it("refuses a price over $9,999.99", () => {
    expect(edit({ intent: "update-price", price: "10000" })).toEqual({
      error: "Price cannot exceed $9,999.99.",
      status: 400,
    });
  });

  it("turns PPP on from the string 'true'", () => {
    edit({ intent: "update-ppp-enabled", pppEnabled: "true" });

    expect(editorFor(base.course.id).course.pppEnabled).toBe(true);
  });

  it("changes the status and the sales copy", () => {
    edit({ intent: "update-status", status: CourseStatus.Archived });
    edit({ intent: "update-sales-copy", salesCopy: "New copy" });

    const { course } = editorFor(base.course.id);
    expect([course.status, course.salesCopy]).toEqual([
      CourseStatus.Archived,
      "New copy",
    ]);
  });
});

describe("editCourse: modules and lessons", () => {
  it("appends modules and lessons at the end", () => {
    addModuleWithLessons("First", ["A", "B"]);
    addModuleWithLessons("Second", ["C"]);

    expect(outline()).toEqual([
      { title: "First", lessons: ["A", "B"] },
      { title: "Second", lessons: ["C"] },
    ]);
  });

  it("deletes a module together with its lessons", () => {
    const first = addModuleWithLessons("First", ["A"]);
    addModuleWithLessons("Second", ["B"]);

    expect(edit({ intent: "delete-module", moduleId: first })).toEqual({
      success: true,
      field: "module",
    });
    expect(outline()).toEqual([{ title: "Second", lessons: ["B"] }]);
  });

  it("reorders modules and lessons", () => {
    const first = addModuleWithLessons("First", ["A", "B"]);
    const second = addModuleWithLessons("Second", []);

    edit({
      intent: "reorder-modules",
      moduleIds: JSON.stringify([second, first]),
    });
    edit({
      intent: "reorder-lessons",
      moduleId: first,
      lessonIds: JSON.stringify([lessonId("B"), lessonId("A")]),
    });

    expect(outline()).toEqual([
      { title: "Second", lessons: [] },
      { title: "First", lessons: ["B", "A"] },
    ]);
  });

  it("moves a lesson into another module at the given position", () => {
    addModuleWithLessons("First", ["A", "B", "C"]);
    const second = addModuleWithLessons("Second", ["X", "Y"]);

    expect(
      edit({
        intent: "move-lesson",
        lessonId: lessonId("B"),
        targetModuleId: second,
        targetPosition: 2,
      })
    ).toEqual({ success: true, field: "lesson-move" });
    expect(outline()).toEqual([
      { title: "First", lessons: ["A", "C"] },
      { title: "Second", lessons: ["X", "B", "Y"] },
    ]);
  });

  it("renames and deletes a lesson", () => {
    addModuleWithLessons("First", ["A", "B"]);

    edit({ intent: "rename-lesson", lessonId: lessonId("A"), title: "A2" });
    edit({ intent: "delete-lesson", lessonId: lessonId("B") });

    expect(outline()).toEqual([{ title: "First", lessons: ["A2"] }]);
  });

  it("refuses to touch a module from another course", () => {
    const other = createOtherCourse();
    edit({ intent: "add-module", title: "Theirs" }, other.id);
    const theirs = moduleId("Theirs", other.id);

    expect(
      edit({ intent: "rename-module", moduleId: theirs, title: "Mine" })
    ).toEqual({ error: "Module not found in this course.", status: 404 });
  });

  it("refuses to move a lesson into another course's module", () => {
    addModuleWithLessons("First", ["A"]);
    const other = createOtherCourse();
    edit({ intent: "add-module", title: "Theirs" }, other.id);

    expect(
      edit({
        intent: "move-lesson",
        lessonId: lessonId("A"),
        targetModuleId: moduleId("Theirs", other.id),
        targetPosition: 1,
      })
    ).toEqual({
      error: "Target module not found in this course.",
      status: 404,
    });
  });

  it("reports a lesson that does not exist", () => {
    expect(edit({ intent: "delete-lesson", lessonId: 9999 })).toEqual({
      error: "Lesson not found.",
      status: 404,
    });
  });
});
