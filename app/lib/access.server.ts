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
export function findPurchaseForAccess(
  database: Db,
  userId: number,
  courseId: number
) {
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
//
// getAccess never throws — the lesson page needs to render a paywall preview for
// signed-out and unenrolled visitors rather than erroring. The require* wrappers
// are built on it for the routes that should just reject.
//
// Uses positional parameters (project convention).

export type Access = {
  userId: number | null;
  user: ReturnType<typeof getUserById>;
  isAdmin: boolean;
  /** The instructor who owns this specific course. */
  isOwningInstructor: boolean;
  /** Owning instructor or admin — the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * Staff always can. Students need an enrollment that isn't PPP-blocked.
   */
  canViewContent: boolean;
};

const SIGNED_OUT: Access = {
  userId: null,
  user: undefined,
  isAdmin: false,
  isOwningInstructor: false,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

/**
 * The Access rules, given who is asking and where from. Never throws: an
 * unknown or null user gets the signed-out result. `currentCountry` is only
 * read for an enrolled Student, the one case PPP can restrict.
 */
export function resolveAccess(
  database: Db,
  userId: number | null,
  courseId: number,
  currentCountry: string | null
): Access {
  if (!userId) return SIGNED_OUT;

  const user = getUserById(database, userId);
  if (!user) return SIGNED_OUT;

  const course = getCourseById(database, courseId);
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course?.instructorId === userId;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled = isUserEnrolled(database, userId, courseId);

  // PPP only restricts students who bought at a discount — staff are exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isStaff && course) {
    // A Refunded Purchase no longer decides where the Student may watch from.
    const purchase = findPurchaseForAccess(database, userId, courseId);
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      currentCountry
    );
  }

  return {
    userId,
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}

/**
 * Access for the user in the request's session. The country is resolved only
 * when it can matter (an enrolled Student), as before: resolving it may call
 * out to an IP lookup service.
 */
export async function getAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  const userId = await getCurrentUserId(request);
  const access = resolveAccess(db, userId, courseId, null);
  if (!access.enrolled || access.isStaff) return access;

  return resolveAccess(db, userId, courseId, await resolveCountry(request));
}

/**
 * Throws 401 unless someone is signed in. Returns their user id.
 */
export async function requireUserId(request: Request): Promise<number> {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  return userId;
}

/**
 * Throws 401 when signed out, 403 when the user can't see the course's content.
 * Use in actions — loader guards don't protect actions.
 */
export async function requireContentAccess(
  request: Request,
  courseId: number
): Promise<Access> {
  const access = await getAccess(request, courseId);

  if (!access.userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }

  return access;
}

export type CourseStaffCheck =
  | {
      ok: true;
      user: NonNullable<Access["user"]>;
      course: NonNullable<ReturnType<typeof getCourseById>>;
      isAdmin: boolean;
    }
  | { ok: false; status: 401 | 403 | 404; message: string };

/**
 * Is this user staff on this course: its owning Instructor, or an Admin?
 * Never throws. The refusals come in a fixed order: signed out or unknown
 * user (401), then no such course (404), then not staff (403).
 */
export function checkCourseStaff(
  database: Db,
  userId: number | null,
  courseId: number
): CourseStaffCheck {
  const access = resolveAccess(database, userId, courseId, null);
  if (!access.user) {
    return {
      ok: false,
      status: 401,
      message: "Select a user from the DevUI panel.",
    };
  }

  const course = getCourseById(database, courseId);
  if (!course) {
    return { ok: false, status: 404, message: "Course not found." };
  }

  if (!access.isStaff) {
    return {
      ok: false,
      status: 403,
      message: "Only this course's instructor can do that.",
    };
  }

  return { ok: true, user: access.user, course, isAdmin: access.isAdmin };
}

/**
 * Throws 401, 404 or 403 (see checkCourseStaff) unless the session's user is
 * the course's owning Instructor or an Admin. Parse the course id with
 * parseParams first, so a malformed id is a 400. Call it in every loader and
 * every action — loader guards don't protect actions.
 */
export async function requireCourseStaff(request: Request, courseId: number) {
  const userId = await getCurrentUserId(request);
  const result = checkCourseStaff(db, userId, courseId);

  if (!result.ok) {
    throw data(result.message, { status: result.status });
  }

  return { user: result.user, course: result.course, isAdmin: result.isAdmin };
}

/**
 * Throws unless the user is an Instructor. Admins are refused: creating
 * courses, and the list of one's own courses, are for Instructors only.
 */
export async function requireInstructor(request: Request) {
  const userId = await requireUserId(request);
  const user = getUserById(db, userId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return { userId, user };
}

/**
 * Throws unless the user is an instructor or an admin, without tying them to a
 * particular course — for pages that span all of someone's courses.
 */
export async function requireInstructorOrAdmin(request: Request) {
  const userId = await requireUserId(request);
  const user = getUserById(db, userId);

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
export async function requireAdmin(request: Request) {
  const userId = await requireUserId(request);
  const user = getUserById(db, userId);

  if (!user || user.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return { userId, user };
}
