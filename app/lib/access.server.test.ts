import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import {
  checkCourseStaff,
  findPurchaseForAccess,
  resolveAccess,
} from "./access.server";
import { makeRefundRequest } from "./refund-eligibility.server";
import { resolveRefundRequest } from "./refund-request-resolve.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  admin = testDb
    .insert(schema.users)
    .values({
      name: "Ada Admin",
      email: "admin@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
});

function buyCourse(userId: number, amountPaid = 4999, country = "US") {
  const purchase = testDb
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid, country })
    .returning()
    .get();
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function requestRefund(purchaseId: number) {
  const result = makeRefundRequest(testDb, {
    purchaseId,
    reason: "The course was not what I expected.",
  });
  if (!result.ok) throw new Error(result.error);
  return result.refundRequest;
}

/** Gives the course a price, so a PPP Purchase can restrict where it is watched. */
function setCoursePricing(pppEnabled = true) {
  testDb
    .update(schema.courses)
    .set({ price: 9999, pppEnabled })
    .where(eq(schema.courses.id, base.course.id))
    .run();
}

/** The course's owner loses the Instructor role but still owns the course. */
function demoteOwner() {
  testDb
    .update(schema.users)
    .set({ role: UserRole.Student })
    .where(eq(schema.users.id, base.instructor.id))
    .run();
}

function approveRefund(purchaseId: number) {
  resolveRefundRequest(testDb, {
    refundRequestId: requestRefund(purchaseId).id,
    adminUserId: admin.id,
    resolution: RefundRequestStatus.Approved,
  });
}

/** A stub for the lazy country lookup, so a test can see whether it ran. */
function countryGetter(country: string | null) {
  return vi.fn(async () => country);
}

describe("resolveAccess", () => {
  it("treats a null user as signed out", async () => {
    const access = await resolveAccess(
      testDb,
      null,
      base.course.id,
      countryGetter("US")
    );

    expect(access).toMatchObject({
      userId: null,
      user: undefined,
      isStaff: false,
      enrolled: false,
      pppBlocked: false,
      canViewContent: false,
    });
  });

  it("treats an unknown user as signed out", async () => {
    const access = await resolveAccess(
      testDb,
      9999,
      base.course.id,
      countryGetter("US")
    );

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("lets the owning Instructor view content without an Enrollment", async () => {
    const access = await resolveAccess(
      testDb,
      base.instructor.id,
      base.course.id,
      countryGetter("US")
    );

    expect(access).toMatchObject({
      userId: base.instructor.id,
      isOwningInstructor: true,
      isAdmin: false,
      isStaff: true,
      enrolled: false,
      canViewContent: true,
    });
  });

  it("lets an enrolled Student view content from the same country", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");

    const access = await resolveAccess(
      testDb,
      base.user.id,
      base.course.id,
      countryGetter("IN")
    );

    expect(access).toMatchObject({
      isStaff: false,
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("blocks a PPP Purchase viewed from a different country", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");
    const getCountry = countryGetter("US");

    const access = await resolveAccess(
      testDb,
      base.user.id,
      base.course.id,
      getCountry
    );

    expect(getCountry).toHaveBeenCalledTimes(1);

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });
  });

  it("does not let a Refunded PPP Purchase block", async () => {
    setCoursePricing();
    const refunded = buyCourse(base.user.id, 2999, "IN");
    approveRefund(refunded.id);
    // Enrolled again without a Purchase of their own, as by Redeeming a Coupon.
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    const access = await resolveAccess(
      testDb,
      base.user.id,
      base.course.id,
      countryGetter("BR")
    );

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("never blocks when the course has PPP turned off", async () => {
    setCoursePricing(false);
    buyCourse(base.user.id, 2999, "IN");

    const access = await resolveAccess(
      testDb,
      base.user.id,
      base.course.id,
      countryGetter("US")
    );

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });

  it("does not let a demoted owner view content without an Enrollment", async () => {
    demoteOwner();

    const access = await resolveAccess(
      testDb,
      base.instructor.id,
      base.course.id,
      countryGetter("US")
    );

    expect(access).toMatchObject({
      userId: base.instructor.id,
      isOwningInstructor: false,
      isStaff: false,
      enrolled: false,
      canViewContent: false,
    });
  });

  it("applies the PPP rules to a demoted owner who is enrolled", async () => {
    setCoursePricing();
    demoteOwner();
    buyCourse(base.instructor.id, 2999, "IN");

    const access = await resolveAccess(
      testDb,
      base.instructor.id,
      base.course.id,
      countryGetter("US")
    );

    expect(access).toMatchObject({
      isStaff: false,
      enrolled: true,
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });
  });

  it("never blocks an Admin", async () => {
    setCoursePricing();
    buyCourse(admin.id, 2999, "IN");

    const access = await resolveAccess(
      testDb,
      admin.id,
      base.course.id,
      countryGetter("US")
    );

    expect(access).toMatchObject({
      isAdmin: true,
      isStaff: true,
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });
});

describe("resolveAccess country lookup", () => {
  it("does not look up the country for staff, signed-out or unenrolled users", async () => {
    setCoursePricing();
    buyCourse(admin.id, 2999, "IN");
    const getCountry = countryGetter("US");

    const callers = [
      null, // signed out
      9999, // unknown user
      base.instructor.id, // owning Instructor
      admin.id, // enrolled Admin with a PPP Purchase
      base.user.id, // unenrolled Student
    ];
    for (const userId of callers) {
      await resolveAccess(testDb, userId, base.course.id, getCountry);
    }

    expect(getCountry).not.toHaveBeenCalled();
  });
});

describe("checkCourseStaff", () => {
  it("refuses with 401 when no one is signed in", () => {
    expect(checkCourseStaff(testDb, null, base.course.id)).toEqual({
      ok: false,
      status: 401,
      message: "Select a user from the DevUI panel.",
    });
  });

  it("refuses with 401 when the user id is unknown", () => {
    expect(checkCourseStaff(testDb, 9999, base.course.id)).toEqual({
      ok: false,
      status: 401,
      message: "Select a user from the DevUI panel.",
    });
  });

  it("refuses with 404 an Instructor when the course does not exist", () => {
    expect(checkCourseStaff(testDb, base.instructor.id, 9999)).toEqual({
      ok: false,
      status: 404,
      message: "Course not found.",
    });
  });

  it("refuses with 404 an Instructor who does not own the course", () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other@example.com",
        role: UserRole.Instructor,
      })
      .returning()
      .get();

    expect(checkCourseStaff(testDb, other.id, base.course.id)).toEqual({
      ok: false,
      status: 404,
      message: "Course not found.",
    });
  });

  it("refuses with 404 a Student when the course exists, even an enrolled one", () => {
    buyCourse(base.user.id);

    expect(checkCourseStaff(testDb, base.user.id, base.course.id)).toEqual({
      ok: false,
      status: 404,
      message: "Course not found.",
    });
  });

  it("refuses with 404 a Student when the course does not exist", () => {
    expect(checkCourseStaff(testDb, base.user.id, 9999)).toEqual({
      ok: false,
      status: 404,
      message: "Course not found.",
    });
  });

  it("refuses with 404 an owner whose role is no longer Instructor", () => {
    demoteOwner();

    expect(
      checkCourseStaff(testDb, base.instructor.id, base.course.id)
    ).toEqual({
      ok: false,
      status: 404,
      message: "Course not found.",
    });
  });

  it("refuses with 404 a demoted owner who is enrolled", () => {
    demoteOwner();
    buyCourse(base.instructor.id);

    expect(
      checkCourseStaff(testDb, base.instructor.id, base.course.id)
    ).toEqual({
      ok: false,
      status: 404,
      message: "Course not found.",
    });
  });

  it("lets the owning Instructor through", () => {
    const result = checkCourseStaff(testDb, base.instructor.id, base.course.id);

    expect(result).toMatchObject({
      ok: true,
      user: { id: base.instructor.id },
      course: { id: base.course.id },
      isAdmin: false,
    });
  });

  it("lets an Admin through on a course they do not own", () => {
    const result = checkCourseStaff(testDb, admin.id, base.course.id);

    expect(result).toMatchObject({
      ok: true,
      user: { id: admin.id },
      course: { id: base.course.id },
      isAdmin: true,
    });
  });
});

describe("findPurchaseForAccess", () => {
  it("ignores a Purchase whose Refund Request was Approved", () => {
    const refunded = buyCourse(base.user.id);
    resolveRefundRequest(testDb, {
      refundRequestId: requestRefund(refunded.id).id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
    });

    expect(
      findPurchaseForAccess(testDb, base.user.id, base.course.id)
    ).toBeUndefined();

    const again = buyCourse(base.user.id);

    expect(
      findPurchaseForAccess(testDb, base.user.id, base.course.id)?.id
    ).toBe(again.id);
  });
});
