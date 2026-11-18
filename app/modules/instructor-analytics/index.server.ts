// Entry point of the Instructor Analytics module: everything the
// /instructor/analytics page shows. The queries and the rules behind them
// live in lib/ and are not importable from outside.
export {
  type AnalyticsParams,
  parseAnalyticsParams,
} from "./lib/analytics-params";
export {
  type AnalyticsPage,
  type AnalyticsViewer,
  loadAnalyticsPage,
} from "./lib/analytics-page.server";
export {
  type CourseFunnel,
  type CourseProgressSummary,
  type FunnelLesson,
} from "./lib/course-progress.server";
export { type QuizPassRate } from "./lib/quiz-pass-rates.server";
export { type RefundExposure } from "./lib/refund-exposure.server";
