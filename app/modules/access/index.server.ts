// Entry point of the Access module: "who is asking, and what may they do with
// this course?". Routes and page modules import Access from here only; the
// rules behind it live in lib/ and are not importable from outside.
//
// resolveAccess, checkCourseStaff and findPurchaseForAccess are exported only
// for the module's existing tests. #81 replaces those tests with tests through
// the Request-based checks and drops these exports.
export {
  getAccess,
  requireAdmin,
  requireContentAccess,
  requireCourseStaff,
  requireInstructor,
  requireInstructorOrAdmin,
  requireUserId,
  type Access,
  // For the module's tests only (see above).
  checkCourseStaff,
  findPurchaseForAccess,
  resolveAccess,
} from "./lib/access.server";
