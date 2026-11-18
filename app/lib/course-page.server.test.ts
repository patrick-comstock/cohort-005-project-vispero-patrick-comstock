import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { LessonProgressStatus } from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

import {
  type CourseViewer,
  loadCourseProgress,
  loadCoursePurchaseState,
} from "./course-page.server";

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

describe("loadCoursePurchaseState", () => {
  it("gives a signed-out visitor no Team Purchase and no Refund Request", () => {
    expect(
      loadCoursePurchaseState(testDb, base.course.id, {
        userId: null,
        enrolled: false,
      })
    ).toEqual({
      hasTeamPurchase: false,
      refundRequestOffer: null,
      refundRequestRefusal: null,
      refundRequest: null,
    });
  });

  it("knows a buyer whose Purchase has Coupons made a Team Purchase", () => {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const purchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.instructor.id,
        courseId: base.course.id,
        amountPaid: 9998,
        country: "US",
      })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "TEAM-1",
        purchaseId: purchase.id,
      })
      .run();

    expect(
      loadCoursePurchaseState(testDb, base.course.id, {
        userId: base.instructor.id,
        enrolled: false,
      }).hasTeamPurchase
    ).toBe(true);
  });
});
