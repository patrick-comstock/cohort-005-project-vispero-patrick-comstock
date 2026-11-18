// Entry point of the Course Editor module: what a Course Manager sees and
// changes on /instructor/:courseId. loadCourseEditor gathers the page;
// editCourse applies one parsed courseEditorIntentSchema edit and returns
// either what it saved or a refusal to show. The queries behind them live in
// lib/ and are not importable from outside.
export { loadCourseEditor } from "./lib/course-editor-page.server";
export {
  type CourseEditorIntent,
  courseEditorIntentSchema,
  editCourse,
} from "./lib/course-edits.server";
