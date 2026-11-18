import { CheckCircle2, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { Link, useFetcher, useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { LessonProgressStatus } from "~/db/schema";

/**
 * Marks the lesson complete (posting the "mark-complete" intent) and then moves
 * the Student on to the next lesson, or shows that it is already completed.
 */
export function LessonCompletion({
  courseSlug,
  lessonId,
  lessonStatus,
  nextLesson,
}: {
  courseSlug: string;
  lessonId: number;
  lessonStatus: string | null;
  nextLesson: { id: number; title: string } | null;
}) {
  const fetcher = useFetcher<{ success?: boolean }>({
    key: `mark-complete-${lessonId}`,
  });
  const navigate = useNavigate();

  const isMarking =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "mark-complete";

  const justCompleted = fetcher.data?.success;

  const isCompleted =
    lessonStatus === LessonProgressStatus.Completed || justCompleted;

  // Navigate to next lesson after marking complete
  useEffect(() => {
    if (justCompleted && nextLesson) {
      navigate(`/courses/${courseSlug}/lessons/${nextLesson.id}`);
    }
  }, [justCompleted, nextLesson, courseSlug, navigate]);

  return (
    <div className="mb-8">
      {isCompleted ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="size-5" />
            <span className="font-medium">Lesson completed</span>
          </div>
          {nextLesson && (
            <Link to={`/courses/${courseSlug}/lessons/${nextLesson.id}`}>
              <Button variant="outline" size="sm">
                Up next: {nextLesson.title}
                <ChevronRight className="ml-1 size-4" />
              </Button>
            </Link>
          )}
        </div>
      ) : nextLesson ? (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="mark-complete" />
          <Button disabled={isMarking}>
            {isMarking ? (
              "Completing..."
            ) : (
              <>
                Up next: {nextLesson.title}
                <ChevronRight className="ml-1 size-4" />
              </>
            )}
          </Button>
        </fetcher.Form>
      ) : (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="mark-complete" />
          <Button disabled={isMarking}>
            <CheckCircle2 className="mr-2 size-4" />
            {isMarking ? "Marking..." : "Mark as Complete"}
          </Button>
        </fetcher.Form>
      )}
    </div>
  );
}
