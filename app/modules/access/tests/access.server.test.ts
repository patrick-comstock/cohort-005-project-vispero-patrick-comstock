import { eq } from "drizzle-orm";
import type { UNSAFE_DataWithResponseInit } from "react-router";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import { makeRefundRequest } from "~/lib/refund-eligibility.server";
import { resolveRefundRequest } from "~/lib/refund-request-resolve.server";
import { setCurrentUserId, setDevCountry } from "~/lib/session";
import { createTestDb, seedBaseData } from "~/test/setup";

import {
  getAccess,
  isEnrolled,
  requireAdmin,
  requireContentAccess,
  requireCourseManager,
  requireInstructor,
  requireInstructorOrAdmin,
  requireUserId,
} from "../index.server";

type TestDb = ReturnType<typeof createTestDb>;

const URL = "http://localhost/courses/test-course";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The `name=value` part of a Set-Cookie header, as a browser sends it back. */
function cookieFrom(setCookie: string) {
  return setCookie.split(";")[0] ?? "";
}

/** A visitor with no session. */
function signedOutRequest() {
  return new Request(URL);
}

/**
 * A Request carrying the session cookie the app's session storage commits
 * when the DevUI panel switches to this user, and optionally a country.
 */
async function requestAs(userId: number, country?: string) {
  let cookie = cookieFrom(await setCurrentUserId(new Request(URL), userId));
  if (country) {
    cookie = cookieFrom(
      await setDevCountry(
        new Request(URL, { headers: { Cookie: cookie } }),
        country
      )
    );
  }
  return new Request(URL, { headers: { Cookie: cookie } });
}

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

/** Approves a Refund Request for the Purchase, which deletes the Enrollment. */
function approveRefund(purchaseId: number) {
  const request = makeRefundRequest(testDb, {
    purchaseId,
    reason: "The course was not what I expected.",
  });
  if (!request.ok) throw new Error(request.error);
  resolveRefundRequest(testDb, {
    refundRequestId: request.refundRequest.id,
    adminUserId: admin.id,
    resolution: RefundRequestStatus.Approved,
  });
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

describe("getAccess", () => {
  it("treats a visitor with no session as signed out", async () => {
    const access = await getAccess(signedOutRequest(), base.course.id, testDb);

    expect(access).toMatchObject({
      userId: null,
      isCourseManager: false,
      enrolled: false,
      pppBlocked: false,
      canViewContent: false,
    });
  });

  it("hands back the user ID from the session", async () => {
    const access = await getAccess(
      await requestAs(base.instructor.id),
      base.course.id,
      testDb
    );

    expect(access.userId).toBe(base.instructor.id);
  });

  it("hands back only what callers read", async () => {
    const access = await getAccess(
      await requestAs(base.instructor.id),
      base.course.id,
      testDb
    );

    expect(Object.keys(access).sort()).toEqual([
      "canViewContent",
      "enrolled",
      "isCourseManager",
      "pppBlocked",
      "pppBlockedCountry",
      "pppPurchaseCountry",
      "userId",
    ]);
  });

  it("treats an unknown user as signed out", async () => {
    const access = await getAccess(
      await requestAs(9999),
      base.course.id,
      testDb
    );

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("lets the owning Instructor view content without an Enrollment", async () => {
    const access = await getAccess(
      await requestAs(base.instructor.id),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      isCourseManager: true,
      enrolled: false,
      canViewContent: true,
    });
  });

  it("does not let an unenrolled Student view content", async () => {
    const access = await getAccess(
      await requestAs(base.user.id),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      userId: base.user.id,
      isCourseManager: false,
      enrolled: false,
      canViewContent: false,
    });
  });

  it("lets an enrolled Student view content from the same country", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");

    const access = await getAccess(
      await requestAs(base.user.id, "IN"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      isCourseManager: false,
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("blocks a PPP Purchase viewed from a different country", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");

    const access = await getAccess(
      await requestAs(base.user.id, "US"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });
  });

  it("lets the most recent Purchase decide when several still count", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 9999, "US");
    // A second Purchase, at a PPP discount, without a second Enrollment.
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 2999,
        country: "IN",
      })
      .run();

    const access = await getAccess(
      await requestAs(base.user.id, "US"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: true,
      pppPurchaseCountry: "IN",
      canViewContent: false,
    });
  });

  it("lets only the Purchase that still counts decide, after a Refund and buying again", async () => {
    setCoursePricing();
    const refunded = buyCourse(base.user.id, 2999, "IN");
    approveRefund(refunded.id);
    buyCourse(base.user.id, 9999, "US");

    const access = await getAccess(
      await requestAs(base.user.id, "US"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      enrolled: true,
      pppBlocked: false,
      pppPurchaseCountry: null,
      canViewContent: true,
    });
  });

  it("does not let a Refunded PPP Purchase block a later Enrollment", async () => {
    setCoursePricing();
    const refunded = buyCourse(base.user.id, 2999, "IN");
    approveRefund(refunded.id);
    // Enrolled again without a Purchase of their own, as by Redeeming a Coupon.
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    const access = await getAccess(
      await requestAs(base.user.id, "BR"),
      base.course.id,
      testDb
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

    const access = await getAccess(
      await requestAs(base.user.id, "US"),
      base.course.id,
      testDb
    );

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });

  it("does not let a demoted owner view content without an Enrollment", async () => {
    demoteOwner();

    const access = await getAccess(
      await requestAs(base.instructor.id),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      userId: base.instructor.id,
      isCourseManager: false,
      enrolled: false,
      canViewContent: false,
    });
  });

  it("applies the PPP rules to a demoted owner who is enrolled", async () => {
    setCoursePricing();
    demoteOwner();
    buyCourse(base.instructor.id, 2999, "IN");

    const access = await getAccess(
      await requestAs(base.instructor.id, "US"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      isCourseManager: false,
      enrolled: true,
      pppBlocked: true,
      canViewContent: false,
    });
  });

  it("never applies PPP to the owning Instructor", async () => {
    setCoursePricing();
    buyCourse(base.instructor.id, 2999, "IN");

    const access = await getAccess(
      await requestAs(base.instructor.id, "US"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      isCourseManager: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });

  it("lets an Admin view content and never applies PPP to them", async () => {
    setCoursePricing();
    buyCourse(admin.id, 2999, "IN");

    const access = await getAccess(
      await requestAs(admin.id, "US"),
      base.course.id,
      testDb
    );

    expect(access).toMatchObject({
      isCourseManager: true,
      enrolled: true,
      pppBlocked: false,
      canViewContent: true,
    });
  });
});

describe("getAccess country lookup", () => {
  /**
   * With no country in the session and no Cloudflare header, the country is
   * looked up over the network from the forwarded IP. A stubbed fetch shows
   * whether that lookup ran.
   */
  function stubIpLookup(countryCode: string) {
    const lookup = vi.fn(async () => Response.json({ countryCode }));
    vi.stubGlobal("fetch", lookup);
    return lookup;
  }

  function withForwardedIp(request: Request) {
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-For", "203.0.113.7");
    return new Request(request.url, { headers });
  }

  it("looks up the country for an enrolled Student, the case PPP can restrict", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");
    const lookup = stubIpLookup("US");

    const access = await getAccess(
      withForwardedIp(await requestAs(base.user.id)),
      base.course.id,
      testDb
    );

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(access.pppBlocked).toBe(true);
  });

  it("does not look up the country when it cannot matter", async () => {
    setCoursePricing();
    buyCourse(admin.id, 2999, "IN");
    const lookup = stubIpLookup("US");

    const requests = [
      signedOutRequest(),
      await requestAs(9999), // unknown user
      await requestAs(base.instructor.id), // owning Instructor
      await requestAs(admin.id), // enrolled Admin with a PPP Purchase
      await requestAs(base.user.id), // unenrolled Student
    ];
    for (const request of requests) {
      await getAccess(withForwardedIp(request), base.course.id, testDb);
    }

    expect(lookup).not.toHaveBeenCalled();
  });
});

const SIGNED_OUT = {
  status: 401,
  data: "Select a user from the DevUI panel.",
};

function isThrownData(
  error: unknown
): error is UNSAFE_DataWithResponseInit<unknown> {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "DataWithResponseInit"
  );
}

/** What a route would see when the check throws: the status and message. */
async function refusal(check: Promise<unknown>) {
  try {
    await check;
  } catch (error) {
    // react-router's data() throws a DataWithResponseInit, exported as a type only.
    if (isThrownData(error)) {
      return { status: error.init?.status, data: error.data };
    }
    throw error;
  }
  throw new Error("Expected the check to refuse.");
}

describe("requireUserId", () => {
  it("refuses a signed-out visitor with 401", async () => {
    expect(await refusal(requireUserId(signedOutRequest()))).toEqual(
      SIGNED_OUT
    );
  });

  it("hands back the user ID from the session", async () => {
    expect(await requireUserId(await requestAs(base.user.id))).toBe(
      base.user.id
    );
  });
});

describe("requireContentAccess", () => {
  it("refuses a signed-out visitor with 401", async () => {
    expect(
      await refusal(
        requireContentAccess(signedOutRequest(), base.course.id, testDb)
      )
    ).toEqual(SIGNED_OUT);
  });

  it("refuses an unknown user with 401", async () => {
    expect(
      await refusal(
        requireContentAccess(await requestAs(9999), base.course.id, testDb)
      )
    ).toEqual(SIGNED_OUT);
  });

  it("refuses an unenrolled Student with 403", async () => {
    expect(
      await refusal(
        requireContentAccess(
          await requestAs(base.user.id),
          base.course.id,
          testDb
        )
      )
    ).toEqual({ status: 403, data: "You must be enrolled in this course." });
  });

  it("refuses a PPP-blocked Student with 403", async () => {
    setCoursePricing();
    buyCourse(base.user.id, 2999, "IN");

    expect(
      await refusal(
        requireContentAccess(
          await requestAs(base.user.id, "US"),
          base.course.id,
          testDb
        )
      )
    ).toEqual({ status: 403, data: "You must be enrolled in this course." });
  });

  it("hands an enrolled Student's user ID to the route", async () => {
    buyCourse(base.user.id);

    const { userId } = await requireContentAccess(
      await requestAs(base.user.id),
      base.course.id,
      testDb
    );

    expectTypeOf(userId).toEqualTypeOf<number>();
    expect(userId).toBe(base.user.id);
  });
});

describe("requireCourseManager", () => {
  function otherInstructor() {
    return testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other@example.com",
        role: UserRole.Instructor,
      })
      .returning()
      .get();
  }

  const NOT_FOUND = { status: 404, data: "Course not found." };

  it("refuses a signed-out visitor with 401", async () => {
    expect(
      await refusal(
        requireCourseManager(signedOutRequest(), base.course.id, testDb)
      )
    ).toEqual(SIGNED_OUT);
  });

  it("refuses an unknown user with 401", async () => {
    expect(
      await refusal(
        requireCourseManager(await requestAs(9999), base.course.id, testDb)
      )
    ).toEqual(SIGNED_OUT);
  });

  it("refuses with 404 an Instructor when the course does not exist", async () => {
    expect(
      await refusal(
        requireCourseManager(await requestAs(base.instructor.id), 9999, testDb)
      )
    ).toEqual(NOT_FOUND);
  });

  it("refuses with 404 an Instructor who does not own the course", async () => {
    expect(
      await refusal(
        requireCourseManager(
          await requestAs(otherInstructor().id),
          base.course.id,
          testDb
        )
      )
    ).toEqual(NOT_FOUND);
  });

  it("refuses with 404 an enrolled Student, the same as a missing course", async () => {
    buyCourse(base.user.id);
    const request = await requestAs(base.user.id);

    expect(
      await refusal(requireCourseManager(request, base.course.id, testDb))
    ).toEqual(NOT_FOUND);
    expect(await refusal(requireCourseManager(request, 9999, testDb))).toEqual(
      NOT_FOUND
    );
  });

  it("refuses with 404 a demoted owner, even an enrolled one", async () => {
    demoteOwner();
    buyCourse(base.instructor.id);

    expect(
      await refusal(
        requireCourseManager(
          await requestAs(base.instructor.id),
          base.course.id,
          testDb
        )
      )
    ).toEqual(NOT_FOUND);
  });

  it("lets the owning Instructor through", async () => {
    const result = await requireCourseManager(
      await requestAs(base.instructor.id),
      base.course.id,
      testDb
    );

    expect(result).toMatchObject({
      user: { id: base.instructor.id },
      course: { id: base.course.id },
    });
  });

  it("hands back only what callers read", async () => {
    const result = await requireCourseManager(
      await requestAs(base.instructor.id),
      base.course.id,
      testDb
    );

    expect(Object.keys(result).sort()).toEqual(["course", "user"]);
  });

  it("lets an Admin through on a course they do not own", async () => {
    const result = await requireCourseManager(
      await requestAs(admin.id),
      base.course.id,
      testDb
    );

    expect(result).toMatchObject({
      user: { id: admin.id },
      course: { id: base.course.id },
    });
  });
});

describe("requireInstructor", () => {
  it("refuses a signed-out visitor with 401", async () => {
    expect(
      await refusal(requireInstructor(signedOutRequest(), testDb))
    ).toEqual(SIGNED_OUT);
  });

  it("refuses an Admin with 403", async () => {
    expect(
      await refusal(requireInstructor(await requestAs(admin.id), testDb))
    ).toEqual({ status: 403, data: "Only instructors can access this page." });
  });

  it("lets an Instructor through", async () => {
    const result = await requireInstructor(
      await requestAs(base.instructor.id),
      testDb
    );

    expect(result.userId).toBe(base.instructor.id);
  });
});

describe("requireInstructorOrAdmin", () => {
  it("refuses a signed-out visitor with 401", async () => {
    expect(
      await refusal(requireInstructorOrAdmin(signedOutRequest(), testDb))
    ).toEqual(SIGNED_OUT);
  });

  it("refuses a Student with 403", async () => {
    expect(
      await refusal(
        requireInstructorOrAdmin(await requestAs(base.user.id), testDb)
      )
    ).toEqual({ status: 403, data: "Only instructors can access this page." });
  });

  it("lets an Instructor and an Admin through", async () => {
    const instructor = await requireInstructorOrAdmin(
      await requestAs(base.instructor.id),
      testDb
    );
    const asAdmin = await requireInstructorOrAdmin(
      await requestAs(admin.id),
      testDb
    );

    expect(instructor).toMatchObject({
      userId: base.instructor.id,
      isAdmin: false,
    });
    expect(asAdmin).toMatchObject({ userId: admin.id, isAdmin: true });
  });
});

describe("requireAdmin", () => {
  it("refuses a signed-out visitor with 401", async () => {
    expect(await refusal(requireAdmin(signedOutRequest(), testDb))).toEqual(
      SIGNED_OUT
    );
  });

  it("refuses an Instructor with 403", async () => {
    expect(
      await refusal(requireAdmin(await requestAs(base.instructor.id), testDb))
    ).toEqual({ status: 403, data: "Only admins can access this page." });
  });

  it("lets an Admin through", async () => {
    const result = await requireAdmin(await requestAs(admin.id), testDb);

    expect(result.userId).toBe(admin.id);
  });
});

describe("isEnrolled", () => {
  it("is true when the Student has an Enrollment in the course", () => {
    buyCourse(base.user.id);

    expect(isEnrolled(testDb, base.user.id, base.course.id)).toBe(true);
  });

  it("is false for a Student without an Enrollment, even when another Student has one", () => {
    buyCourse(admin.id);

    expect(isEnrolled(testDb, base.user.id, base.course.id)).toBe(false);
  });

  it("is false for the owning Instructor, who needs no Enrollment to view content", () => {
    expect(isEnrolled(testDb, base.instructor.id, base.course.id)).toBe(false);
  });

  it("is false once a Refund Request for the Purchase is Approved", () => {
    const purchase = buyCourse(base.user.id);
    approveRefund(purchase.id);

    expect(isEnrolled(testDb, base.user.id, base.course.id)).toBe(false);
  });

  it("sees an Enrollment created earlier in the same transaction", () => {
    const seen = testDb.transaction((tx) => {
      const before = isEnrolled(tx, base.user.id, base.course.id);
      tx.insert(schema.enrollments)
        .values({ userId: base.user.id, courseId: base.course.id })
        .run();
      const after = isEnrolled(tx, base.user.id, base.course.id);
      return { before, after };
    });

    expect(seen).toEqual({ before: false, after: true });
  });
});
