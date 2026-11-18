import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export enum UserRole {
  Student = "student",
  Instructor = "instructor",
  Admin = "admin",
}

export enum CourseStatus {
  Draft = "draft",
  Published = "published",
  Archived = "archived",
}

export enum LessonProgressStatus {
  NotStarted = "not_started",
  InProgress = "in_progress",
  Completed = "completed",
}

export enum QuestionType {
  MultipleChoice = "multiple_choice",
  TrueFalse = "true_false",
}

export enum RefundRequestStatus {
  Pending = "pending",
  Approved = "approved",
  Declined = "declined",
}

export enum NotificationKind {
  RefundRequestMade = "refund_request_made",
  RefundRequestResolved = "refund_request_resolved",
}

export enum TeamMemberRole {
  Admin = "admin",
  Member = "member",
}

// ─── Tables ───

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().$type<UserRole>(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const courses = sqliteTable(
  "courses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull(),
    notes: text("notes"),
    // Markdown, non-empty. Enforced on write.
    salesCopy: text("sales_copy").notNull(),
    instructorId: integer("instructor_id")
      .notNull()
      .references(() => users.id),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    status: text("status").notNull().$type<CourseStatus>(),
    coverImageUrl: text("cover_image_url"),
    price: integer("price").notNull().default(0),
    pppEnabled: integer("ppp_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("courses_instructor_idx").on(table.instructorId),
    index("courses_category_idx").on(table.categoryId),
  ]
);

export const modules = sqliteTable(
  "modules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("modules_course_idx").on(table.courseId)]
);

export const lessons = sqliteTable(
  "lessons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    moduleId: integer("module_id")
      .notNull()
      .references(() => modules.id),
    title: text("title").notNull(),
    content: text("content"),
    videoUrl: text("video_url"),
    githubRepoUrl: text("github_repo_url"),
    position: integer("position").notNull(),
    durationMinutes: integer("duration_minutes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("lessons_module_idx").on(table.moduleId)]
);

export const enrollments = sqliteTable(
  "enrollments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    enrolledAt: text("enrolled_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("enrollments_user_idx").on(table.userId),
    index("enrollments_course_idx").on(table.courseId),
  ]
);

export const lessonProgress = sqliteTable(
  "lesson_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    lessonId: integer("lesson_id")
      .notNull()
      .references(() => lessons.id),
    status: text("status").notNull().$type<LessonProgressStatus>(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("lesson_progress_user_lesson_idx").on(table.userId, table.lessonId),
    index("lesson_progress_lesson_idx").on(table.lessonId),
  ]
);

export const quizzes = sqliteTable(
  "quizzes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lessonId: integer("lesson_id")
      .notNull()
      .references(() => lessons.id),
    title: text("title").notNull(),
    passingScore: real("passing_score").notNull(),
  },
  (table) => [index("quizzes_lesson_idx").on(table.lessonId)]
);

export const quizQuestions = sqliteTable(
  "quiz_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    quizId: integer("quiz_id")
      .notNull()
      .references(() => quizzes.id),
    questionText: text("question_text").notNull(),
    questionType: text("question_type").notNull().$type<QuestionType>(),
    position: integer("position").notNull(),
  },
  (table) => [index("quiz_questions_quiz_idx").on(table.quizId)]
);

export const quizOptions = sqliteTable(
  "quiz_options",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => quizQuestions.id),
    optionText: text("option_text").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
  },
  (table) => [index("quiz_options_question_idx").on(table.questionId)]
);

export const quizAttempts = sqliteTable(
  "quiz_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    quizId: integer("quiz_id")
      .notNull()
      .references(() => quizzes.id),
    score: real("score").notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    attemptedAt: text("attempted_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("quiz_attempts_user_idx").on(table.userId),
    index("quiz_attempts_quiz_idx").on(table.quizId),
  ]
);

export const quizAnswers = sqliteTable(
  "quiz_answers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    attemptId: integer("attempt_id")
      .notNull()
      .references(() => quizAttempts.id),
    questionId: integer("question_id")
      .notNull()
      .references(() => quizQuestions.id),
    selectedOptionId: integer("selected_option_id")
      .notNull()
      .references(() => quizOptions.id),
  },
  (table) => [
    index("quiz_answers_attempt_idx").on(table.attemptId),
    index("quiz_answers_question_idx").on(table.questionId),
    index("quiz_answers_selected_option_idx").on(table.selectedOptionId),
  ]
);

export const purchases = sqliteTable(
  "purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    amountPaid: integer("amount_paid").notNull(),
    country: text("country"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("purchases_user_idx").on(table.userId),
    index("purchases_course_idx").on(table.courseId),
  ]
);

export const refundRequests = sqliteTable(
  "refund_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => purchases.id),
    status: text("status")
      .notNull()
      .$type<RefundRequestStatus>()
      .default(RefundRequestStatus.Pending),
    // The Student's own words, in the box on the course page.
    reason: text("reason").notNull(),
    // The Refund amount. Null until the Refund Request is Approved — a
    // Declined Refund Request has no Refund.
    refundAmount: integer("refund_amount"),
    requestedAt: text("requested_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
    // The Admin's explanation of the Resolution, which the Requester sees.
    // Required when Declining; optional when Approving. Null while Pending.
    resolutionNote: text("resolution_note"),
  },
  // A Purchase can have at most one Refund Request, ever.
  (table) => [
    uniqueIndex("refund_requests_purchase_unique").on(table.purchaseId),
    index("refund_requests_resolved_by_user_idx").on(table.resolvedByUserId),
  ]
);

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().$type<TeamMemberRole>(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("team_members_team_idx").on(table.teamId),
    index("team_members_user_idx").on(table.userId),
  ]
);

export const coupons = sqliteTable(
  "coupons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    code: text("code").notNull().unique(),
    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => purchases.id),
    redeemedByUserId: integer("redeemed_by_user_id").references(() => users.id),
    redeemedAt: text("redeemed_at"),
    // Set when the Coupon's Team Purchase is Refunded. A Voided Coupon can no
    // longer be Redeemed.
    voidedAt: text("voided_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("coupons_team_idx").on(table.teamId),
    index("coupons_course_idx").on(table.courseId),
    index("coupons_purchase_idx").on(table.purchaseId),
    index("coupons_redeemed_by_user_idx").on(table.redeemedByUserId),
  ]
);

export const courseRatings = sqliteTable(
  "course_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    // Whole stars, 1–5. Enforced on write.
    rating: integer("rating").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("course_ratings_user_course_unique").on(
      table.userId,
      table.courseId
    ),
    index("course_ratings_course_idx").on(table.courseId),
  ]
);

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lessonId: integer("lesson_id")
      .notNull()
      .references(() => lessons.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // Null for a top-level comment. Replies are one level deep only — a parent
    // must itself be top-level. Enforced on write.
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => comments.id
    ),
    // Markdown, 1–5000 chars. Enforced on write, rendered by
    // renderComment (untrusted input — never renderMarkdown).
    body: text("body").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // Null until the author edits. An explicit column rather than comparing
    // updatedAt to createdAt, which collide when both writes land in the same
    // millisecond.
    editedAt: text("edited_at"),
    // Soft delete. Deleted top-level comments keep their replies readable.
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("comments_lesson_idx").on(table.lessonId),
    index("comments_user_idx").on(table.userId),
    index("comments_parent_idx").on(table.parentId),
  ]
);

export const videoWatchEvents = sqliteTable(
  "video_watch_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    lessonId: integer("lesson_id")
      .notNull()
      .references(() => lessons.id),
    eventType: text("event_type").notNull(),
    positionSeconds: real("position_seconds").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("video_watch_events_user_idx").on(table.userId),
    index("video_watch_events_lesson_idx").on(table.lessonId),
  ]
);

// A snapshot of what one person was told (ADR 0005): finished text, written
// in the same transaction as its event, with no reference to its subject.
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull().$type<NotificationKind>(),
    headline: text("headline").notNull(),
    body: text("body"),
    // Path to its subject, e.g. /admin/refund-requests/12.
    link: text("link").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // Null while unread.
    readAt: text("read_at"),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientId, table.createdAt),
  ]
);
