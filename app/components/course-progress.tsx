import { PlayCircle } from "lucide-react";
import { Link } from "react-router";

import { PppRestrictedNotice } from "~/components/ppp-restricted-notice";
import { Button } from "~/components/ui/button";

/**
 * An enrolled Student's progress through the course and the lesson to pick up
 * from. A Student who can't view the content (PPP-blocked) sees why instead.
 */
export function CourseProgress({
  slug,
  tracksProgress,
  progress,
  resumeLessonId,
}: {
  slug: string;
  tracksProgress: boolean;
  progress: number;
  resumeLessonId: number | undefined;
}) {
  if (!tracksProgress) {
    return <PppRestrictedNotice />;
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span>{progress}% complete</span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      {resumeLessonId ? (
        <Link to={`/courses/${slug}/lessons/${resumeLessonId}`}>
          <Button className="w-full">
            <PlayCircle className="mr-2 size-4" />
            {progress > 0 ? "Continue Learning" : "Start Course"}
          </Button>
        </Link>
      ) : null}
    </>
  );
}
