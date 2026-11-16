import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus } from "~/db/schema";
import {
  getCourseProgress,
  getLessonProgressMap,
} from "./course-progress.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

function addModule(courseId: number, position = 1) {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();
}

function addLesson(moduleId: number, position: number) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title: `Lesson ${position}`, position })
    .returning()
    .get();
}

function addProgress(
  userId: number,
  lessonId: number,
  status: LessonProgressStatus
) {
  testDb
    .insert(schema.lessonProgress)
    .values({ userId, lessonId, status })
    .run();
}

function addOtherCourse() {
  return testDb
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Sales copy",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

describe("getCourseProgress", () => {
  it("gives zeros for a course with no modules", () => {
    expect(getCourseProgress(testDb, base.user.id, base.course.id)).toEqual({
      totalLessons: 0,
      completedLessons: 0,
      percent: 0,
    });
  });

  it("ignores a completed lesson in another course", () => {
    addLesson(addModule(base.course.id).id, 1);
    const otherLesson = addLesson(addModule(addOtherCourse().id).id, 1);
    addProgress(base.user.id, otherLesson.id, LessonProgressStatus.Completed);

    expect(getCourseProgress(testDb, base.user.id, base.course.id)).toEqual({
      totalLessons: 1,
      completedLessons: 0,
      percent: 0,
    });
  });

  it("ignores an InProgress lesson", () => {
    const lesson = addLesson(addModule(base.course.id).id, 1);
    addProgress(base.user.id, lesson.id, LessonProgressStatus.InProgress);

    expect(
      getCourseProgress(testDb, base.user.id, base.course.id).completedLessons
    ).toBe(0);
  });

  it("ignores another user's progress", () => {
    const lesson = addLesson(addModule(base.course.id).id, 1);
    addProgress(base.instructor.id, lesson.id, LessonProgressStatus.Completed);

    expect(
      getCourseProgress(testDb, base.user.id, base.course.id).completedLessons
    ).toBe(0);
  });

  it("rounds 1 of 3 completed to 33, as Math.round did in the routes", () => {
    const mod = addModule(base.course.id);
    const first = addLesson(mod.id, 1);
    addLesson(mod.id, 2);
    addLesson(mod.id, 3);
    addProgress(base.user.id, first.id, LessonProgressStatus.Completed);

    expect(getCourseProgress(testDb, base.user.id, base.course.id)).toEqual({
      totalLessons: 3,
      completedLessons: 1,
      percent: 33,
    });
  });

  it("rounds 2 of 3 completed up to 67", () => {
    const mod = addModule(base.course.id);
    const first = addLesson(mod.id, 1);
    const second = addLesson(mod.id, 2);
    addLesson(mod.id, 3);
    addProgress(base.user.id, first.id, LessonProgressStatus.Completed);
    addProgress(base.user.id, second.id, LessonProgressStatus.Completed);

    expect(
      getCourseProgress(testDb, base.user.id, base.course.id).percent
    ).toBe(67);
  });

  it("counts lessons across every module", () => {
    const first = addModule(base.course.id, 1);
    const second = addModule(base.course.id, 2);
    const a = addLesson(first.id, 1);
    const b = addLesson(second.id, 1);
    addProgress(base.user.id, a.id, LessonProgressStatus.Completed);
    addProgress(base.user.id, b.id, LessonProgressStatus.Completed);

    expect(getCourseProgress(testDb, base.user.id, base.course.id)).toEqual({
      totalLessons: 2,
      completedLessons: 2,
      percent: 100,
    });
  });
});

describe("getLessonProgressMap", () => {
  it("maps this course's lessons to their status and nothing else", () => {
    const mod = addModule(base.course.id);
    const done = addLesson(mod.id, 1);
    const started = addLesson(mod.id, 2);
    addLesson(mod.id, 3);
    const otherLesson = addLesson(addModule(addOtherCourse().id).id, 1);
    addProgress(base.user.id, done.id, LessonProgressStatus.Completed);
    addProgress(base.user.id, started.id, LessonProgressStatus.InProgress);
    addProgress(base.user.id, otherLesson.id, LessonProgressStatus.Completed);
    addProgress(base.instructor.id, started.id, LessonProgressStatus.Completed);

    expect(getLessonProgressMap(testDb, base.user.id, base.course.id)).toEqual({
      [done.id]: LessonProgressStatus.Completed,
      [started.id]: LessonProgressStatus.InProgress,
    });
  });

  it("is empty for a course with no modules", () => {
    expect(getLessonProgressMap(testDb, base.user.id, base.course.id)).toEqual(
      {}
    );
  });
});
