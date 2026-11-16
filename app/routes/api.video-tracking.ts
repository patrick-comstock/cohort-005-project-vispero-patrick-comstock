import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.video-tracking";
import { requireContentAccess } from "~/modules/access/index.server";
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
  const { userId } = await requireContentAccess(request, courseId);

  db.insert(videoWatchEvents)
    .values({
      userId,
      lessonId,
      eventType,
      positionSeconds,
    })
    .returning()
    .get();

  return { success: true };
}
