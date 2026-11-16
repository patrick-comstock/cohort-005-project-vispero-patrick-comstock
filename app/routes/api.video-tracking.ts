import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.video-tracking";
import { getCurrentUserId } from "~/lib/session";
import { requireContentAccess } from "~/lib/access.server";
import { getCourseIdForLesson } from "~/lib/lesson-page.server";
import { parseJsonBody } from "~/lib/validation";
import { db } from "~/db";
import { videoWatchEvents } from "~/db/schema";

const videoTrackingSchema = z.object({
  lessonId: z.number(),
  eventType: z.string(),
  positionSeconds: z.number(),
});

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const parsed = await parseJsonBody(request, videoTrackingSchema);

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const { lessonId, eventType, positionSeconds } = parsed.data;

  // Watch events count as progress, so only someone who can view the lesson's
  // course may record them.
  const courseId = getCourseIdForLesson(db, lessonId);
  if (courseId === undefined) {
    throw data("Lesson not found", { status: 404 });
  }
  await requireContentAccess(request, courseId);

  db
    .insert(videoWatchEvents)
    .values({
      userId: currentUserId,
      lessonId,
      eventType,
      positionSeconds,
    })
    .returning()
    .get();

  return { success: true };
}
