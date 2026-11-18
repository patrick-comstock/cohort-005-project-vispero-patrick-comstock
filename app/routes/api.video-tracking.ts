import { data } from "react-router";
import { z } from "zod";

import { db } from "~/db";
import { videoWatchEvents } from "~/db/schema";
import { getCourseIdForLesson } from "~/lib/lesson-page.server";
import { parseJsonBody } from "~/lib/validation";
import {
  requireContentAccess,
  requireUserId,
} from "~/modules/access/index.server";

import type { Route } from "./+types/api.video-tracking";

const videoTrackingSchema = z.object({
  lessonId: z.number(),
  eventType: z.string(),
  positionSeconds: z.number(),
});

export async function action({ request }: Route.ActionArgs) {
  // Sign-in first, so a signed-out caller always gets the 401: never a 400,
  // a 500 from a bad body, or a 404 that reveals whether a lesson exists.
  await requireUserId(request);

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
