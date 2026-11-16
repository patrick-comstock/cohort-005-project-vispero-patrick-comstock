// Entry point of the Access module: "who is asking, and what may they do with
// this course?". Access reads the session from the Request and hands the user
// ID back, so routes and page modules never read the session themselves. They
// import Access from here only; the rules behind it live in lib/ and are not
// importable from outside.
//
// getAccess never throws: it gives a signed-out visitor a null user ID, for
// routes that redirect or render a preview. Every require* check refuses a
// signed-out visitor with the same 401.
export {
  getAccess,
  requireAdmin,
  requireContentAccess,
  requireCourseManager,
  requireInstructor,
  requireInstructorOrAdmin,
  requireUserId,
  type Access,
} from "./lib/access.server";
