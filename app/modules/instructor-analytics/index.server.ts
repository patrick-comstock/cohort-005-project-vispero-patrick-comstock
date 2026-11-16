// Entry point of the Instructor Analytics module: everything the
// /instructor/analytics page shows. The queries and the rules behind them
// live in lib/ and are not importable from outside.
export {
  loadAnalyticsPage,
  parseAnalyticsParams,
  type AnalyticsParams,
  type AnalyticsViewer,
  type CourseFunnel,
  type CourseProgressSummary,
  type FunnelLesson,
  type QuizPassRate,
  type RefundExposure,
} from "./lib/analytics-page.server";
