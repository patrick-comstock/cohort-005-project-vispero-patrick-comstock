import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, seedBaseData } from "~/test/setup";

import {
  getCourseRatingSummary,
  getUserRating,
  rateCourse,
} from "./course-ratings.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

describe("getCourseRatingSummary", () => {
  it("has no average for a course nobody has rated", () => {
    expect(getCourseRatingSummary(testDb, base.course.id)).toEqual({
      average: null,
      count: 0,
    });
  });

  it("averages every rating to one decimal place", () => {
    rateCourse(testDb, base.user.id, base.course.id, 5);
    rateCourse(testDb, base.instructor.id, base.course.id, 4);

    expect(getCourseRatingSummary(testDb, base.course.id)).toEqual({
      average: 4.5,
      count: 2,
    });
  });
});

describe("getUserRating", () => {
  it("is null before the user rates the course", () => {
    expect(getUserRating(testDb, base.user.id, base.course.id)).toBeNull();
  });
});

describe("rateCourse", () => {
  it("replaces the user's earlier rating rather than adding a second", () => {
    rateCourse(testDb, base.user.id, base.course.id, 2);
    rateCourse(testDb, base.user.id, base.course.id, 4);

    expect(getUserRating(testDb, base.user.id, base.course.id)).toBe(4);
    expect(getCourseRatingSummary(testDb, base.course.id).count).toBe(1);
  });

  it("refuses a rating outside the star range", () => {
    expect(() => rateCourse(testDb, base.user.id, base.course.id, 6)).toThrow(
      "Rating must be a whole number between 1 and 5"
    );
  });

  it("refuses a course that does not exist", () => {
    expect(() => rateCourse(testDb, base.user.id, 9999, 3)).toThrow(
      "Course not found"
    );
  });
});
