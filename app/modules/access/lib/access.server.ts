import { data } from "react-router";
import { eq, and, desc, notExists } from "drizzle-orm";
import { db, type Db } from "~/db";
import {
  UserRole,
  enrollments,
  purchases,
  refundRequests,
  RefundRequestStatus,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";
import { getCourseById, getUserById } from "~/lib/courses.server";

/**
 * The Purchase that the PPP check in Access looks at. A Purchase that was
 * Refunded (its Refund Request was Approved) no longer counts.
 */
function findPurchaseForAccess(database: Db, userId: number, courseId: number) {
  return database
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          database
            .select({ id: refundRequests.id })
            .from(refundRequests)
            .where(
              and(
                eq(refundRequests.purchaseId, purchases.id),
                eq(refundRequests.status, RefundRequestStatus.Approved)
              )
            )
        )
      )
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

function isUserEnrolled(database: Db, userId: number, courseId: number) {
  const enrollment = database
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
  return !!enrollment;
}

// ─── Access Resolution ───
// One place that answers "who is this, and what may they do with this course?".
// See the entry point for why getAccess never throws.

type User = NonNullable<ReturnType<typeof getUserById>>;
type Course = ReturnType<typeof getCourseById>;

/** The course's owner, and still an Instructor. A demoted owner is not. */
function isOwningInstructor(user: User, course: Course) {
  return course?.instructorId === user.id && user.role === UserRole.Instructor;
}

/**
 * The one Course Manager rule: an Admin, or the course's owner who still holds
 * the Instructor role. Shared by resolveAccess and requireCourseManager.
 */
function isCourseManager(user: User, course: Course) {
  return user.role === UserRole.Admin || isOwningInstructor(user, course);
}

export type Access = {
  userId: number | null;
  /** The owning Instructor or an Admin: the people who speak for the course. */
  isCourseManager: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * A Course Manager always can. Students need an Enrollment that isn't
   * PPP-blocked.
   */
  canViewContent: boolean;
};

const SIGNED_OUT: Access = {
  userId: null,
  isCourseManager: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

/**
 * The Access rules, given who is asking and where from. Never throws: an
 * unknown or null user gets the signed-out result. `getCountry` is called only
 * for an enrolled user who isn't a Course Manager, the one case PPP can restrict: it may
 * call out to an IP lookup service.
 */
async function resolveAccess(
  database: Db,
  userId: number | null,
  courseId: number,
  getCountry: () => Promise<string | null>
): Promise<Access> {
  if (!userId) return SIGNED_OUT;

  const user = getUserById(database, userId);
  if (!user) return SIGNED_OUT;

  const course = getCourseById(database, courseId);
  const isManager = isCourseManager(user, course);
  const enrolled = isUserEnrolled(database, userId, courseId);

  // PPP only restricts students who bought at a discount; a Course Manager is
  // exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isManager && course) {
    // A Refunded Purchase no longer decides where the Student may watch from.
    const purchase = findPurchaseForAccess(database, userId, courseId);
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      await getCountry()
    );
  }

  return {
    userId,
    isCourseManager: isManager,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isManager || (enrolled && !ppp.blocked),
  };
}

/**
 * Access for the user in the request's session. The country is resolved only
 * when it can matter (see resolveAccess).
 */
export async function getAccess(
  request: Request,
  courseId: number,
  database: Db = db
): Promise<Access> {
  const userId = await getCurrentUserId(request);
  return resolveAccess(database, userId, courseId, () =>
    resolveCountry(request)
  );
}

const SIGNED_OUT_MESSAGE = "Select a user from the DevUI panel.";

/** The one refusal every require* check gives a signed-out visitor. */
function signedOut() {
  return data(SIGNED_OUT_MESSAGE, { status: 401 });
}

/**
 * Throws 401 unless someone is signed in. Returns their user id.
 */
export async function requireUserId(request: Request): Promise<number> {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw signedOut();
  }
  return userId;
}

/**
 * Throws 401 when signed out, 403 when the user can't see the course's content.
 * Hands back their Access, with the user ID the route uses for its own work.
 * Use in actions — loader guards don't protect actions.
 */
export async function requireContentAccess(
  request: Request,
  courseId: number,
  database: Db = db
): Promise<Access & { userId: number }> {
  const access = await getAccess(request, courseId, database);
  const { userId } = access;

  if (!userId) {
    throw signedOut();
  }

  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }

  return { ...access, userId };
}

/**
 * Throws unless the session's user is the course's Course Manager: an Admin,
 * or the course's owner who still holds the Instructor role. Signed out or
 * unknown user is 401. Anyone else gets 404, whether or not the course exists,
 * so its existence isn't revealed. Parse the course id with parseParams first,
 * so a malformed id is a 400. Call it in every loader and every action —
 * loader guards don't protect actions.
 */
export async function requireCourseManager(
  request: Request,
  courseId: number,
  database: Db = db
) {
  const userId = await getCurrentUserId(request);
  const user = userId ? getUserById(database, userId) : undefined;
  if (!user) {
    throw signedOut();
  }

  const course = getCourseById(database, courseId);
  if (!course || !isCourseManager(user, course)) {
    throw data("Course not found.", { status: 404 });
  }

  return { user, course };
}

/**
 * Throws unless the user is an Instructor. Admins are refused: creating
 * courses, and the list of one's own courses, are for Instructors only.
 */
export async function requireInstructor(request: Request, database: Db = db) {
  const userId = await requireUserId(request);
  const user = getUserById(database, userId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return { userId, user };
}

/**
 * Throws unless the user is an instructor or an admin, without tying them to a
 * particular course — for pages that span all of someone's courses.
 */
export async function requireInstructorOrAdmin(
  request: Request,
  database: Db = db
) {
  const userId = await requireUserId(request);
  const user = getUserById(database, userId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return { userId, user, isAdmin: user.role === UserRole.Admin };
}

/**
 * Throws unless the user is an Admin — for pages that run the platform, such
 * as Resolving Refund Requests.
 */
export async function requireAdmin(request: Request, database: Db = db) {
  const userId = await requireUserId(request);
  const user = getUserById(database, userId);

  if (!user || user.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return { userId, user };
}
