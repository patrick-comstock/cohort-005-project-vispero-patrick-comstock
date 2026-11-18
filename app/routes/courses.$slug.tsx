import { AlertTriangle, BookOpen, Clock, Pencil } from "lucide-react";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { data, isRouteErrorResponse } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { CourseContent } from "~/components/course-content";
import { CourseImage } from "~/components/course-image";
import {
  PurchaseOptions,
  TeamPurchaseButton,
} from "~/components/purchase-options";
import { RateCourse } from "~/components/rate-course";
import { RefundRequestForm } from "~/components/refund-request-form";
import { RefundRequestStatusBadge } from "~/components/refund-request-status-badge";
import { StarRating } from "~/components/star-rating";
import { StudentCourseProgress } from "~/components/student-course-progress";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton, skeletonKeys } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/user-avatar";
import { db } from "~/db";
import { resolveCountry } from "~/lib/country.server";
import {
  loadCourseProgress,
  loadCoursePurchaseState,
} from "~/lib/course-page.server";
import {
  getCourseRatingSummary,
  getUserRating,
  rateCourse,
} from "~/lib/course-ratings.server";
import {
  getCourseBySlug,
  getCourseOutline,
  getLessonCount,
} from "~/lib/courses.server";
import { renderMarkdown } from "~/lib/markdown.server";
import { calculatePppPrice, getCountryTierInfo } from "~/lib/ppp";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";
import { getTeamPurchaseButtonLabel } from "~/lib/team-purchase";
import { formatDuration } from "~/lib/utils";
import { parseFormData } from "~/lib/validation";
import { getAccess, requireUserId } from "~/modules/access/index.server";

import type { Route } from "./+types/courses.$slug";

const ratingSchema = z.object({
  rating: z.coerce.number().int().min(MIN_RATING).max(MAX_RATING),
});

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Course";
  return [
    { title: `${title} — Cadence` },
    { name: "description", content: loaderData?.course?.description ?? "" },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const course = getCourseBySlug(db, slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  // Outline only: this page is public, so no lesson body or video.
  const courseWithDetails = getCourseOutline(db, course.id);
  if (!courseWithDetails) {
    throw data("Course not found", { status: 404 });
  }

  const lessonCount = getLessonCount(db, course.id);
  const access = await getAccess(request, course.id);
  const currentUserId = access.userId;
  // Enrolled decides buying; canViewContent decides lesson links and progress.
  // A PPP-blocked Student is enrolled but can't view content.
  const { enrolled, canViewContent } = access;
  const { tracksProgress, progress, lessonProgressMap, nextLessonId } =
    loadCourseProgress(db, course.id, access);

  const {
    hasTeamPurchase,
    refundRequestOffer,
    refundRequestRefusal,
    refundRequest,
  } = loadCoursePurchaseState(db, course.id, access);

  // Render sales copy from Markdown to HTML server-side
  const salesCopyHtml = await renderMarkdown(courseWithDetails.salesCopy);

  const ratingSummary = getCourseRatingSummary(db, course.id);
  const userRating = currentUserId
    ? getUserRating(db, currentUserId, course.id)
    : null;

  const country = await resolveCountry(request);
  const pppPrice = courseWithDetails.pppEnabled
    ? calculatePppPrice(courseWithDetails.price, country)
    : courseWithDetails.price;
  const tierInfo = getCountryTierInfo(country);

  return {
    course: courseWithDetails,
    salesCopyHtml,
    lessonCount,
    enrolled,
    canViewContent,
    hasTeamPurchase,
    tracksProgress,
    progress,
    lessonProgressMap,
    nextLessonId,
    currentUserId,
    pppPrice,
    tierInfo,
    ratingSummary,
    userRating,
    refundRequestOffer,
    refundRequestRefusal,
    refundRequest,
  };
}

// Enrollment is handled via the purchase confirmation page — this action only
// records star ratings.
export async function action({ params, request }: Route.ActionArgs) {
  await requireUserId(request);

  const course = getCourseBySlug(db, params.slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  // Rating asks "are you enrolled?", so a PPP-blocked Student may still rate.
  const access = await getAccess(request, course.id);
  if (!access.userId || !access.enrolled) {
    throw data("You must be enrolled in this course to rate it.", {
      status: 403,
    });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, ratingSchema);

  if (!parsed.success) {
    return data(
      { error: "Please choose a rating from 1 to 5." },
      { status: 400 }
    );
  }

  rateCourse(db, access.userId, course.id, parsed.data.rating);

  return { ok: true as const, error: null };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6">
        <Skeleton className="h-4 w-48" />
      </nav>
      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Skeleton className="mb-6 aspect-video rounded-lg" />
          <Skeleton className="mb-2 h-4 w-20" />
          <Skeleton className="mb-3 h-9 w-3/4" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-4 h-4 w-2/3" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
      <Skeleton className="mb-4 h-8 w-40" />
      <div className="space-y-4">
        {skeletonKeys(3).map((key) => (
          <Card key={key}>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {skeletonKeys(4).map((key) => (
                  <Skeleton key={key} className="h-8 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function CourseDetail({ loaderData }: Route.ComponentProps) {
  const {
    course,
    salesCopyHtml,
    lessonCount,
    enrolled,
    canViewContent,
    hasTeamPurchase,
    tracksProgress,
    progress,
    lessonProgressMap,
    nextLessonId,
    currentUserId,
    pppPrice,
    tierInfo,
    ratingSummary,
    userRating,
    refundRequestOffer,
    refundRequestRefusal,
    refundRequest,
  } = loaderData;
  const isInstructor = currentUserId === course.instructorId;
  const teamPurchaseButtonLabel = getTeamPurchaseButtonLabel({
    isInstructor,
    enrolled,
    hasTeamPurchase,
  });
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("already_enrolled") === "1") {
      toast.info("You're already enrolled in this course.");
      setSearchParams(
        (prev) => {
          prev.delete("already_enrolled");
          return prev;
        },
        { replace: true }
      );
    }
  }, [searchParams, setSearchParams]);

  const totalDuration = course.modules.reduce(
    (sum, mod) =>
      sum + mod.lessons.reduce((s, l) => s + (l.durationMinutes ?? 0), 0),
    0
  );

  const isSignedIn = Boolean(currentUserId);

  const teamPurchaseButton = (
    <TeamPurchaseButton
      slug={course.slug}
      isSignedIn={isSignedIn}
      label={teamPurchaseButtonLabel}
    />
  );

  const refundRequestStatus = refundRequest && (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Refund Request</span>
        <RefundRequestStatusBadge status={refundRequest.status} />
      </div>
      {refundRequest.resolutionNote && (
        <p className="mt-2 rounded bg-muted p-2 text-sm text-muted-foreground">
          {refundRequest.resolutionNote}
        </p>
      )}
    </div>
  );

  const purchaseOptions = (
    <PurchaseOptions
      slug={course.slug}
      price={course.price}
      pppPrice={pppPrice}
      tierLabel={tierInfo.label}
      isSignedIn={isSignedIn}
      teamPurchaseButtonLabel={teamPurchaseButtonLabel}
    />
  );

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/courses" className="hover:text-foreground">
          Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{course.title}</span>
      </nav>

      {/* Hero section */}
      <div className="mb-8">
        <div className="mb-6 aspect-video max-h-64 overflow-hidden rounded-lg">
          <CourseImage
            src={course.coverImageUrl}
            alt={course.title}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="mb-2 text-sm font-medium text-primary">
          {course.categoryName}
        </div>
        <div className="mb-3 flex items-start justify-between gap-4">
          <h1 className="text-4xl font-bold">{course.title}</h1>
          {currentUserId === course.instructorId && (
            <Link to={`/instructor/${course.id}`}>
              <Button variant="outline" size="sm" className="shrink-0">
                <Pencil className="mr-1.5 size-3.5" />
                Edit Course
              </Button>
            </Link>
          )}
        </div>
        <StarRating
          average={ratingSummary.average}
          count={ratingSummary.count}
          size="md"
          className="mb-3"
        />
        <p className="mb-4 text-lg text-muted-foreground">
          {course.description}
        </p>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <UserAvatar
              name={course.instructorName}
              avatarUrl={course.instructorAvatarUrl}
              className="size-5"
            />
            {course.instructorName}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="size-4" />
            {lessonCount} lessons
          </span>
          {totalDuration > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-4" />
              {formatDuration(totalDuration)} total
            </span>
          )}
        </div>
      </div>

      {/* Two-column: sales copy left, sidebar right */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left column: sales copy + course content */}
        <div className="lg:col-span-2">
          <div
            className="prose prose-neutral dark:prose-invert max-w-none"
            // eslint-disable-next-line react/no-danger -- sales copy is Instructor-written markdown, trusted by design (app/lib/markdown.server.ts)
            dangerouslySetInnerHTML={{ __html: salesCopyHtml }}
          />

          {/* Bottom CTA */}
          {!enrolled && !isInstructor && (
            <div className="mt-8 rounded-lg border bg-muted/50 p-6">
              <h3 className="mb-2 text-lg font-semibold">
                Ready to get started?
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Join this course and start learning today.
              </p>
              <div className="space-y-4">{purchaseOptions}</div>
            </div>
          )}

          <div className="mt-8">
            <CourseContent
              course={course}
              canViewContent={canViewContent}
              isInstructor={isInstructor}
              lessonProgressMap={lessonProgressMap}
            />
          </div>
        </div>

        {/* Right column: progress/enrollment card */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">
                {isInstructor
                  ? "Your Course"
                  : enrolled
                    ? "Your Progress"
                    : "Get Started"}
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              {isInstructor ? (
                <Link to={`/instructor/${course.id}`}>
                  <Button className="w-full">
                    <Pencil className="mr-2 size-4" />
                    Manage Course
                  </Button>
                </Link>
              ) : enrolled ? (
                <>
                  <StudentCourseProgress
                    slug={course.slug}
                    tracksProgress={tracksProgress}
                    progress={progress}
                    resumeLessonId={
                      nextLessonId ?? course.modules[0]?.lessons[0]?.id
                    }
                  />
                  {teamPurchaseButton}
                  <RateCourse userRating={userRating} />
                  {refundRequestStatus ? (
                    refundRequestStatus
                  ) : refundRequestOffer ? (
                    <RefundRequestForm
                      slug={course.slug}
                      amount={refundRequestOffer.amount}
                      lastDayInWindow={refundRequestOffer.lastDayInWindow}
                    />
                  ) : refundRequestRefusal ? (
                    <p className="text-sm text-muted-foreground">
                      {refundRequestRefusal}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  {refundRequestStatus}
                  {purchaseOptions}
                </>
              )}
              <div className="space-y-2 pt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4" />
                  <span>{lessonCount} lessons</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="size-4" />
                  <span>{formatDuration(totalDuration)} total</span>
                </div>
                <div className="flex items-center gap-2">
                  <UserAvatar
                    name={course.instructorName}
                    avatarUrl={course.instructorAvatarUrl}
                    className="size-5"
                  />
                  <span>Taught by {course.instructorName}</span>
                </div>
                {course.instructorBio && (
                  <p className="mt-2 text-xs leading-relaxed">
                    {course.instructorBio}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this course.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Course not found";
      message =
        "The course you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
