import { Link, redirect } from "react-router";
import type { Route } from "./+types/courses.$slug.welcome";
import { db } from "~/db";
import { getCourseBySlug, getCourseOutline } from "~/lib/courses.server";
import { getAccess } from "~/modules/access/index.server";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { PppRestrictedNotice } from "~/components/ppp-restricted-notice";
import { PartyPopper, MessageCircle, PlayCircle } from "lucide-react";
import { data } from "react-router";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Welcome";
  return [
    { title: `Welcome to ${title} — Cadence` },
    { name: "description", content: `You're enrolled in ${title}!` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const course = getCourseBySlug(db, slug);

  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  // The welcome page is for an Enrollment; a Course Manager previewing without
  // one may see it too. A PPP-blocked Student is enrolled but can't start a
  // lesson.
  const access = await getAccess(request, course.id);
  if (!access.enrolled && !access.isCourseManager) {
    throw redirect(`/courses/${slug}`);
  }

  // Outline only: the page links to the first lesson and needs no lesson body
  // or video, which a PPP-blocked Student may not see.
  const courseWithDetails = getCourseOutline(db, course.id);
  if (!courseWithDetails) {
    throw data("Course not found.", { status: 404 });
  }

  const discordInviteUrl = process.env.DISCORD_INVITE_URL || null;

  return {
    course: courseWithDetails,
    discordInviteUrl,
    enrolled: access.enrolled,
    canViewContent: access.canViewContent,
  };
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { course, discordInviteUrl, enrolled, canViewContent } = loaderData;

  const firstLessonId =
    course.modules.length > 0 && course.modules[0].lessons.length > 0
      ? course.modules[0].lessons[0].id
      : null;

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <Card>
        <CardContent className="p-8 text-center">
          <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
            <PartyPopper className="size-8 text-primary" />
          </div>

          <h1 className="mb-2 text-3xl font-bold">
            Welcome to {course.title}!
          </h1>
          <p className="mb-8 text-lg text-muted-foreground">
            {!enrolled
              ? "You're previewing the page new Students see."
              : canViewContent
                ? "You're officially enrolled. Here's how to get started."
                : "You're enrolled, but you can't view the course from where you are."}
          </p>

          <div className="space-y-4">
            {discordInviteUrl && (
              <a
                href={discordInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Button variant="outline" size="lg" className="w-full max-w-sm">
                  <MessageCircle className="mr-2 size-5" />
                  Join the Discord Community
                </Button>
              </a>
            )}

            {!canViewContent ? (
              <>
                <div className="mx-auto max-w-sm">
                  <PppRestrictedNotice />
                </div>
                <Link to={`/courses/${course.slug}`}>
                  <Button size="lg" className="w-full max-w-sm">
                    Go to Course
                  </Button>
                </Link>
              </>
            ) : firstLessonId ? (
              <Link to={`/courses/${course.slug}/lessons/${firstLessonId}`}>
                <Button size="lg" className="w-full max-w-sm">
                  <PlayCircle className="mr-2 size-5" />
                  Start Learning
                </Button>
              </Link>
            ) : (
              <Link to={`/courses/${course.slug}`}>
                <Button size="lg" className="w-full max-w-sm">
                  Go to Course
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
