import { and, count, eq, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { Db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  UserRole,
  users,
} from "~/db/schema";
import { rangeStart } from "~/lib/analytics";
import type { AnalyticsScope } from "~/lib/analytics-scope.server";

/**
 * Unanswered questions. A question qualifies when it is top-level, not
 * deleted, not written by staff, and has no reply from the course's
 * instructor or an admin. Split rather than filtered by the range: questions
 * older than it are still reported, because months of silence is the urgent
 * case.
 */
export function getUnansweredQuestions(
  database: Db,
  { instructorId, range, now }: AnalyticsScope
) {
  const questionsSince = rangeStart(range, now);
  const questionAuthor = alias(users, "author");
  const reply = alias(comments, "reply");
  const replyAuthor = alias(users, "reply_author");

  // Correlated: matches a live reply, by staff, to the outer question.
  const staffReply = database
    .select({ one: sql`1` })
    .from(reply)
    .innerJoin(replyAuthor, eq(replyAuthor.id, reply.userId))
    .where(
      and(
        eq(reply.parentId, comments.id),
        isNull(reply.deletedAt),
        or(
          eq(replyAuthor.role, UserRole.Admin),
          eq(reply.userId, courses.instructorId)
        )
      )
    );

  const questionConditions = [
    isNull(comments.parentId),
    isNull(comments.deletedAt),
    // Staff asking their own question shouldn't queue up as work for themselves.
    ne(questionAuthor.role, UserRole.Admin),
    ne(comments.userId, courses.instructorId),
    notExists(staffReply),
  ];

  if (instructorId !== null) {
    questionConditions.push(eq(courses.instructorId, instructorId));
  }

  const questionRow = database
    .select({
      inRange:
        questionsSince === null
          ? count(comments.id)
          : sql<number>`sum(case when ${comments.createdAt} >= ${questionsSince} then 1 else 0 end)`,
      total: count(comments.id),
    })
    .from(comments)
    .innerJoin(questionAuthor, eq(comments.userId, questionAuthor.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(...questionConditions))
    .get();

  // sum() is null over an empty set; count() is already 0.
  const questionsInRange = Number(questionRow?.inRange ?? 0);
  return {
    inRange: questionsInRange,
    older: (questionRow?.total ?? 0) - questionsInRange,
  };
}
