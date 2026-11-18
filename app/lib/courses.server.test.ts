import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import {
  courseSearchCondition,
  getBestAttempt,
  getCourseById,
  getCourseBySlug,
  getCourseOutline,
  getCourseWithDetails,
  getLessonCount,
  getQuizByLessonId,
  getUserById,
} from "./courses.server";

type TestDb = ReturnType<typeof createTestDb>;

const MISSING_ID = 9999;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

function addModule(courseId: number, title: string, position: number) {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title, position })
    .returning()
    .get();
}

function addLesson(moduleId: number, title: string, position: number) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

function addEmptyCourse() {
  return testDb
    .insert(schema.courses)
    .values({
      title: "Empty Course",
      slug: "empty-course",
      description: "No modules yet",
      salesCopy: "Sales copy",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Draft,
    })
    .returning()
    .get();
}

describe("courseSearchCondition", () => {
  // Base data has "Test Course" / "A test course"; addEmptyCourse adds
  // "Empty Course" / "No modules yet".
  function searchSlugs(term: string | null) {
    const query = testDb
      .select({ slug: schema.courses.slug })
      .from(schema.courses);
    const condition = courseSearchCondition(term);
    const rows = condition ? query.where(condition).all() : query.all();
    return rows.map((row) => row.slug).sort();
  }

  beforeEach(() => {
    addEmptyCourse();
  });

  it("matches on the title", () => {
    expect(searchSlugs("Empty")).toEqual(["empty-course"]);
  });

  it("matches on the description", () => {
    expect(searchSlugs("modules yet")).toEqual(["empty-course"]);
  });

  it("matches a term in either field across courses", () => {
    expect(searchSlugs("course")).toEqual(["empty-course", "test-course"]);
  });

  it("matches nothing for a term in neither field", () => {
    expect(searchSlugs("zzz-no-match")).toEqual([]);
  });

  it("returns no condition for an empty or missing term", () => {
    expect(courseSearchCondition("")).toBeUndefined();
    expect(courseSearchCondition(null)).toBeUndefined();
    expect(searchSlugs("")).toEqual(["empty-course", "test-course"]);
  });
});

describe("getUserById", () => {
  it("returns the user", () => {
    expect(getUserById(testDb, base.user.id)?.email).toBe("test@example.com");
  });

  it("returns undefined for an unknown id", () => {
    expect(getUserById(testDb, MISSING_ID)).toBeUndefined();
  });
});

describe("getCourseById", () => {
  it("returns the course", () => {
    expect(getCourseById(testDb, base.course.id)?.slug).toBe("test-course");
  });

  it("returns undefined for an unknown id", () => {
    expect(getCourseById(testDb, MISSING_ID)).toBeUndefined();
  });
});

describe("getCourseBySlug", () => {
  it("returns the course", () => {
    expect(getCourseBySlug(testDb, "test-course")?.id).toBe(base.course.id);
  });

  it("returns undefined for an unknown slug", () => {
    expect(getCourseBySlug(testDb, "no-such-course")).toBeUndefined();
  });
});

describe("getCourseWithDetails", () => {
  it("returns null for an unknown id", () => {
    expect(getCourseWithDetails(testDb, MISSING_ID)).toBeNull();
  });

  it("includes the Instructor and category", () => {
    const course = getCourseWithDetails(testDb, base.course.id);
    expect(course?.instructorName).toBe("Test Instructor");
    expect(course?.categoryName).toBe("Programming");
  });

  it("orders modules and their lessons by position", () => {
    // Inserted out of order so that insertion order cannot pass the test.
    const second = addModule(base.course.id, "Second", 2);
    const first = addModule(base.course.id, "First", 1);
    addLesson(first.id, "1.2", 2);
    addLesson(first.id, "1.1", 1);
    addLesson(second.id, "2.1", 1);

    const course = getCourseWithDetails(testDb, base.course.id);

    expect(
      course?.modules.map((m) => ({
        title: m.title,
        lessons: m.lessons.map((l) => l.title),
      }))
    ).toEqual([
      { title: "First", lessons: ["1.1", "1.2"] },
      { title: "Second", lessons: ["2.1"] },
    ]);
  });

  it("returns no modules for a course without any", () => {
    expect(getCourseWithDetails(testDb, base.course.id)?.modules).toEqual([]);
  });
});

describe("getCourseOutline", () => {
  it("returns null for an unknown id", () => {
    expect(getCourseOutline(testDb, MISSING_ID)).toBeNull();
  });

  it("includes the Instructor and category", () => {
    const course = getCourseOutline(testDb, base.course.id);
    expect(course?.instructorName).toBe("Test Instructor");
    expect(course?.categoryName).toBe("Programming");
  });

  it("orders modules and their lessons by position", () => {
    const second = addModule(base.course.id, "Second", 2);
    const first = addModule(base.course.id, "First", 1);
    addLesson(first.id, "1.2", 2);
    addLesson(first.id, "1.1", 1);
    addLesson(second.id, "2.1", 1);

    const course = getCourseOutline(testDb, base.course.id);

    expect(
      course?.modules.map((m) => ({
        title: m.title,
        lessons: m.lessons.map((l) => l.title),
      }))
    ).toEqual([
      { title: "First", lessons: ["1.1", "1.2"] },
      { title: "Second", lessons: ["2.1"] },
    ]);
  });

  it("never returns a lesson's content, video or code link", () => {
    const mod = addModule(base.course.id, "M", 1);
    testDb
      .insert(schema.lessons)
      .values({
        moduleId: mod.id,
        title: "Secret",
        position: 1,
        content: "Paid content",
        videoUrl: "https://example.com/video",
        githubRepoUrl: "https://github.com/example/repo",
        durationMinutes: 12,
      })
      .run();

    const lessons = getCourseOutline(testDb, base.course.id)?.modules.flatMap(
      (m) => m.lessons
    );

    expect(lessons).toHaveLength(1);
    for (const lesson of lessons ?? []) {
      expect(lesson).not.toHaveProperty("content");
      expect(lesson).not.toHaveProperty("videoUrl");
      expect(lesson).not.toHaveProperty("githubRepoUrl");
    }
    expect(lessons?.[0]?.durationMinutes).toBe(12);
  });

  it("returns no modules for a course without any", () => {
    expect(getCourseOutline(testDb, base.course.id)?.modules).toEqual([]);
  });
});

describe("getLessonCount", () => {
  it("counts lessons across every module of the course", () => {
    const first = addModule(base.course.id, "First", 1);
    const second = addModule(base.course.id, "Second", 2);
    addLesson(first.id, "1.1", 1);
    addLesson(first.id, "1.2", 2);
    addLesson(second.id, "2.1", 1);

    expect(getLessonCount(testDb, base.course.id)).toBe(3);
  });

  it("does not count another course's lessons", () => {
    const other = addEmptyCourse();
    const otherModule = addModule(other.id, "Other", 1);
    addLesson(otherModule.id, "Other lesson", 1);

    expect(getLessonCount(testDb, base.course.id)).toBe(0);
  });

  it("returns 0 for a course with no modules", () => {
    expect(getLessonCount(testDb, addEmptyCourse().id)).toBe(0);
  });

  it("returns 0 for a course whose modules have no lessons", () => {
    addModule(base.course.id, "Empty module", 1);
    expect(getLessonCount(testDb, base.course.id)).toBe(0);
  });
});

describe("getQuizByLessonId", () => {
  it("returns the lesson's quiz", () => {
    const lesson = addLesson(addModule(base.course.id, "M", 1).id, "L", 1);
    testDb
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
      .run();

    expect(getQuizByLessonId(testDb, lesson.id)?.title).toBe("Quiz");
  });

  it("returns undefined for a lesson without a quiz", () => {
    expect(getQuizByLessonId(testDb, MISSING_ID)).toBeUndefined();
  });
});

describe("getBestAttempt", () => {
  let quizId: number;

  beforeEach(() => {
    const lesson = addLesson(addModule(base.course.id, "M", 1).id, "L", 1);
    quizId = testDb
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
      .returning()
      .get().id;
  });

  function addAttempt(userId: number, score: number) {
    testDb
      .insert(schema.quizAttempts)
      .values({ userId, quizId, score, passed: score >= 0.7 })
      .run();
  }

  it("returns the attempt with the highest score, not the latest", () => {
    addAttempt(base.user.id, 0.4);
    addAttempt(base.user.id, 0.9);
    addAttempt(base.user.id, 0.6);

    const best = getBestAttempt(testDb, base.user.id, quizId);

    expect(best?.score).toBe(0.9);
    expect(best?.passed).toBe(true);
  });

  it("ignores other users' attempts", () => {
    addAttempt(base.instructor.id, 1);
    addAttempt(base.user.id, 0.5);

    expect(getBestAttempt(testDb, base.user.id, quizId)?.score).toBe(0.5);
  });

  it("returns undefined when the user has no attempt", () => {
    expect(getBestAttempt(testDb, base.user.id, quizId)).toBeUndefined();
  });
});
