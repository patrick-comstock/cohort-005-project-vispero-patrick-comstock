import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundRequestStatus, UserRole } from "~/db/schema";
import { makeRefundRequest } from "./refund-eligibility.server";
import { resolveRefundRequest } from "./refund-request-resolve.server";
import { listInstructorRefundRequests } from "./instructor-refund-requests.server";

type TestDb = ReturnType<typeof createTestDb>;

let testDb: TestDb;
let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;
let otherInstructor: typeof schema.users.$inferSelect;
let otherCourse: typeof schema.courses.$inferSelect;

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
  otherInstructor = testDb
    .insert(schema.users)
    .values({
      name: "Other Instructor",
      email: "other-instructor@example.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get();
  otherCourse = testDb
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Sales copy.",
      instructorId: otherInstructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
});

function buyCourse(courseId: number, userId = base.user.id) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid: 4999, country: "US" })
    .returning()
    .get();
}

function requestRefund(purchaseId: number, reason = "Not what I expected.") {
  const result = makeRefundRequest(testDb, { purchaseId, reason });
  if (!result.ok) throw new Error(result.error);
  return result.refundRequest;
}

describe("listInstructorRefundRequests", () => {
  it("shows an Instructor only the Refund Requests for their own courses", () => {
    const mine = requestRefund(buyCourse(base.course.id).id);
    requestRefund(buyCourse(otherCourse.id).id);

    const { pending } = listInstructorRefundRequests(
      testDb,
      base.instructor.id
    );

    expect(pending.map((r) => r.id)).toEqual([mine.id]);
  });

  it("shows an Admin the Refund Requests for every course", () => {
    const first = requestRefund(buyCourse(base.course.id).id);
    const second = requestRefund(buyCourse(otherCourse.id).id);

    const { pending } = listInstructorRefundRequests(testDb, null);

    expect(pending.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it("lists Resolved Refund Requests as a history with each Resolution Note", () => {
    const approved = requestRefund(buyCourse(base.course.id).id, "Too basic.");
    resolveRefundRequest(testDb, {
      refundRequestId: approved.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Approved,
      resolutionNote: "Refunded as a courtesy.",
    });
    const declined = requestRefund(
      buyCourse(base.course.id).id,
      "Changed my mind."
    );
    resolveRefundRequest(testDb, {
      refundRequestId: declined.id,
      adminUserId: admin.id,
      resolution: RefundRequestStatus.Declined,
      resolutionNote: "Outside our policy.",
    });

    const { pending, resolved } = listInstructorRefundRequests(
      testDb,
      base.instructor.id
    );

    expect(pending).toEqual([]);
    expect(resolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approved.id,
          status: RefundRequestStatus.Approved,
          reason: "Too basic.",
          resolutionNote: "Refunded as a courtesy.",
          requesterName: "Test User",
        }),
        expect.objectContaining({
          id: declined.id,
          status: RefundRequestStatus.Declined,
          reason: "Changed my mind.",
          resolutionNote: "Outside our policy.",
        }),
      ])
    );
  });

  it("does not show Instructors the refund amount or the amount paid", () => {
    requestRefund(buyCourse(base.course.id).id);

    const [row] = listInstructorRefundRequests(
      testDb,
      base.instructor.id
    ).pending;

    expect(row).not.toHaveProperty("refundAmount");
    expect(row).not.toHaveProperty("amountPaid");
  });

  it("includes Team Purchase Refund Requests, showing the buyer as a Team Purchase", () => {
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = buyCourse(base.course.id);
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "TEAM-1",
        purchaseId: teamPurchase.id,
      })
      .run();
    requestRefund(teamPurchase.id);
    requestRefund(buyCourse(base.course.id).id);

    const { pending } = listInstructorRefundRequests(
      testDb,
      base.instructor.id
    );

    expect(pending).toMatchObject([
      { requesterName: "Test User", isTeamPurchase: true },
      { requesterName: "Test User", isTeamPurchase: false },
    ]);
  });
});
