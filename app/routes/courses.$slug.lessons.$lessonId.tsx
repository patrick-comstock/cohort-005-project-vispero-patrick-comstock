import { eq } from "drizzle-orm";
import { AlertTriangle, Clock, Github, NotebookText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { data, isRouteErrorResponse } from "react-router";
import { z } from "zod";

import { CommentThread } from "~/components/comment-thread";
import { CurriculumSidebar } from "~/components/curriculum-sidebar";
import { LessonCompletion } from "~/components/lesson-completion";
import { LessonPager } from "~/components/lesson-pager";
import { PppRestrictedScreen } from "~/components/ppp-restricted-screen";
import { QuizSection } from "~/components/quiz-section";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { YouTubePlayer } from "~/components/youtube-player";
import { db } from "~/db";
import { lessons, modules } from "~/db/schema";
import {
  getCourseBySlug,
  getCourseWithDetails,
  getUserById,
} from "~/lib/courses.server";
import {
  createComment,
  deleteComment,
  getCommentById,
  getLessonComments,
  updateComment,
} from "~/lib/lesson-comments.server";
import {
  getAdjacentLessons,
  getCourseIdForLesson,
  loadLessonPage,
  markLessonComplete,
} from "~/lib/lesson-page.server";
import { getQuizById, gradeQuizAttempt } from "~/lib/quiz-attempt.server";
import { formatDuration } from "~/lib/utils";
import { parseFormData, parseParams } from "~/lib/validation";
import { getAccess, requireContentAccess } from "~/modules/access/index.server";

import type { Route } from "./+types/courses.$slug.lessons.$lessonId";

const lessonParamsSchema = z.object({
  slug: z.string().min(1),
  lessonId: z.coerce.number().int(),
});

const createCommentSchema = z.object({
  intent: z.literal("create-comment"),
  body: z.string(),
  parentId: z.coerce.number().int().optional(),
});

const editCommentSchema = z.object({
  intent: z.literal("edit-comment"),
  commentId: z.coerce.number().int(),
  body: z.string(),
});

const deleteCommentSchema = z.object({
  intent: z.literal("delete-comment"),
  commentId: z.coerce.number().int(),
});

function getLessonById(id: number) {
  return db.select().from(lessons).where(eq(lessons.id, id)).get();
}

function getModuleById(id: number) {
  return db.select().from(modules).where(eq(modules.id, id)).get();
}

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.lesson?.title ?? "Lesson";
  const courseTitle = loaderData?.course?.title ?? "Course";
  return [{ title: `${title} — ${courseTitle} — Cadence` }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const lessonId = Number(params.lessonId);

  if (isNaN(lessonId)) {
    throw data("Invalid lesson ID", { status: 400 });
  }

  const course = getCourseBySlug(db, slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const courseWithDetails = getCourseWithDetails(db, course.id);
  if (!courseWithDetails) {
    throw data("Course not found", { status: 404 });
  }

  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }

  const mod = getModuleById(lesson.moduleId);
  if (!mod) {
    throw data("Module not found", { status: 404 });
  }

  // Verify lesson belongs to this course
  if (mod.courseId !== course.id) {
    throw data("Lesson not found in this course", { status: 404 });
  }

  const access = await getAccess(request, course.id);
  const currentUserId = access.userId;
  const enrolled = access.enrolled;

  // PPP Access Guard — resolved by getAccess, which treats a blocked user as
  // having no access to the course's content at all.
  const { pppBlocked, pppBlockedCountry, pppPurchaseCountry, canViewContent } =
    access;

  // Without canViewContent, only the lesson's metadata leaves the server, and
  // no progress is written.
  const lessonPage = await loadLessonPage(db, lessonId, course.id, access);

  // Comments are confidential to the course: only people who can read the
  // lesson can read the discussion on it.
  const instructor = getUserById(db, course.instructorId);
  const comments = canViewContent ? await getLessonComments(db, lessonId) : [];

  const { prevLesson, nextLesson } = getAdjacentLessons(
    courseWithDetails,
    lessonId
  );

  return {
    course: {
      id: courseWithDetails.id,
      title: courseWithDetails.title,
      slug: courseWithDetails.slug,
    },
    curriculum: courseWithDetails.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
      })),
    })),
    module: {
      id: mod.id,
      title: mod.title,
    },
    ...lessonPage,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    pppBlocked,
    pppBlockedCountry,
    pppPurchaseCountry,
    comments,
    canViewContent,
    canModerate: access.isCourseManager,
    instructorName: instructor?.name ?? "your instructor",
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { slug, lessonId } = parseParams(params, lessonParamsSchema);

  const course = getCourseBySlug(db, slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  // Access is checked against the course in the URL, so the lesson must belong
  // to it — otherwise a lesson in another course could be reached through here.
  if (getCourseIdForLesson(db, lessonId) !== course.id) {
    throw data("Lesson not found in this course", { status: 404 });
  }

  // Every intent writes to the course's content (comments, progress, quiz
  // attempts), so all of them re-check access here rather than relying on the
  // loader — loader guards don't protect actions.
  const access = await requireContentAccess(request, course.id);
  const currentUserId = access.userId;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (
    intent === "create-comment" ||
    intent === "edit-comment" ||
    intent === "delete-comment"
  ) {
    try {
      return handleCommentIntent(intent, formData, lessonId, access);
    } catch (error) {
      // Service validation failures are user-correctable; anything thrown as a
      // Response (404 above) should keep bubbling.
      if (error instanceof Error) {
        return data({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  if (intent === "mark-complete") {
    markLessonComplete(db, currentUserId, lessonId);
    return { success: true };
  }

  if (intent === "submit-quiz") {
    const quizId = Number(formData.get("quizId"));
    if (isNaN(quizId)) {
      throw data("Invalid quiz ID", { status: 400 });
    }
    // Scope the quiz to this lesson, which the access check above covers.
    if (getQuizById(db, quizId)?.lessonId !== lessonId) {
      throw data("Quiz not found", { status: 404 });
    }

    // Collect answers: form fields named "question-{questionId}" with value = optionId
    const selectedAnswers: Record<number, number> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("question-")) continue;
      const questionId = Number(key.replace("question-", ""));
      const optionId = Number(value);
      if (!isNaN(questionId) && !isNaN(optionId)) {
        selectedAnswers[questionId] = optionId;
      }
    }

    const result = gradeQuizAttempt(db, currentUserId, quizId, selectedAnswers);
    if (!result) {
      throw data("Failed to score quiz", { status: 500 });
    }

    return { quizResult: result };
  }

  throw data("Invalid action", { status: 400 });
}

// The action's catch turns a service's Error into a 400 for these intents.
function handleCommentIntent(
  intent: "create-comment" | "edit-comment" | "delete-comment",
  formData: FormData,
  lessonId: number,
  access: { userId: number; isCourseManager: boolean }
) {
  if (intent === "create-comment") {
    const parsed = parseFormData(formData, createCommentSchema);
    if (!parsed.success) {
      return data(
        { error: "Enter a comment before posting." },
        { status: 400 }
      );
    }
    createComment(
      db,
      access.userId,
      lessonId,
      parsed.data.parentId ?? null,
      parsed.data.body
    );
    return { ok: true };
  }

  if (intent === "edit-comment") {
    const parsed = parseFormData(formData, editCommentSchema);
    if (!parsed.success) {
      return data({ error: "Enter a comment before saving." }, { status: 400 });
    }
    // Scope the id to this lesson so a comment elsewhere can't be reached
    // by posting its id to this route.
    const existing = getCommentById(db, parsed.data.commentId);
    if (!existing || existing.lessonId !== lessonId) {
      throw data("Comment not found", { status: 404 });
    }
    updateComment(db, parsed.data.commentId, access.userId, parsed.data.body);
    return { ok: true };
  }

  const parsed = parseFormData(formData, deleteCommentSchema);
  if (!parsed.success) {
    return data({ error: "Could not delete that comment." }, { status: 400 });
  }
  const existing = getCommentById(db, parsed.data.commentId);
  if (!existing || existing.lessonId !== lessonId) {
    throw data("Comment not found", { status: 404 });
  }
  deleteComment(
    db,
    parsed.data.commentId,
    access.userId,
    access.isCourseManager
  );
  return { ok: true };
}

const AUTOPLAY_KEY = "cadence-autoplay";

function useAutoplay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(AUTOPLAY_KEY) === "true");
    } catch {
      /* silently fail */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOPLAY_KEY, String(next));
      } catch {
        /* silently fail */
      }
      return next;
    });
  }, []);

  return [enabled, toggle] as const;
}

export default function LessonViewer({ loaderData }: Route.ComponentProps) {
  const {
    course,
    curriculum,
    module: mod,
    lesson,
    lessonBody,
    lessonStatus,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    quiz,
    bestAttempt,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
    pppBlocked,
    pppBlockedCountry,
    pppPurchaseCountry,
    comments,
    canViewContent,
    canModerate,
    instructorName,
  } = loaderData;
  const [autoplay, toggleAutoplay] = useAutoplay();
  const quizFetcher = useFetcher({ key: `quiz-${lesson.id}` });

  const quizResult = quizFetcher.data?.quizResult ?? null;
  const isSubmittingQuiz = quizFetcher.state !== "idle";

  if (pppBlocked) {
    return (
      <PppRestrictedScreen
        courseSlug={course.slug}
        purchaseCountry={pppPurchaseCountry}
        currentCountry={pppBlockedCountry}
      />
    );
  }

  return (
    <div className="flex">
      {/* Curriculum Sidebar */}
      <CurriculumSidebar
        course={course}
        curriculum={curriculum}
        currentLessonId={lesson.id}
        lessonProgressMap={lessonProgressMap}
        enrolled={enrolled}
      />

      <div className="flex-1 p-6 lg:p-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link to="/courses" className="hover:text-foreground">
            Courses
          </Link>
          <span className="mx-2">/</span>
          <Link
            to={`/courses/${course.slug}`}
            className="hover:text-foreground"
          >
            {course.title}
          </Link>
          <span className="mx-2">/</span>
          <Link
            to={`/courses/${course.slug}/${mod.id}`}
            className="hover:text-foreground"
          >
            {mod.title}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{lesson.title}</span>
        </nav>

        <div className="mx-auto max-w-4xl">
          {/* Lesson Title */}
          <h1 className="mb-2 text-3xl font-bold">{lesson.title}</h1>
          <div className="mb-6 flex items-center gap-3">
            {lesson.durationMinutes && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="size-4" />
                {formatDuration(lesson.durationMinutes)}
              </div>
            )}
            {lessonBody?.githubRepoUrl && (
              <a
                href={lessonBody.githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <Github className="mr-1.5 size-4" />
                  Open Code
                </Button>
              </a>
            )}
          </div>

          {/* Without Access, the loader sends no lesson body at all */}
          {!lessonBody && (
            <Card className="mb-8">
              <CardContent className="py-12 text-center text-muted-foreground">
                <p className="mb-4">
                  Enroll in this course to view this lesson.
                </p>
                <Link to={`/courses/${course.slug}`}>
                  <Button variant="outline">View Course</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* YouTube Video */}
          {lessonBody?.videoUrl && (
            <YouTubePlayer
              videoUrl={lessonBody.videoUrl}
              lessonId={lesson.id}
              title={lesson.title}
              startPosition={lastWatchPosition}
              durationMinutes={lesson.durationMinutes}
              watchProgress={watchProgress}
              trackingEnabled={enrolled && !!currentUserId}
              autoplay={autoplay}
              onToggleAutoplay={toggleAutoplay}
            />
          )}

          {lessonBody?.contentHtml && (
            <Card className="mb-8">
              <CardContent className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <NotebookText className="size-5 text-primary" />
                  <h2 className="text-xl font-semibold">Lesson notes</h2>
                </div>
                <div
                  className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base"
                  // eslint-disable-next-line react/no-danger -- lesson content is Instructor-written markdown, trusted by design (app/lib/markdown.server.ts)
                  dangerouslySetInnerHTML={{ __html: lessonBody.contentHtml }}
                />
              </CardContent>
            </Card>
          )}

          {lessonBody && !lessonBody.contentHtml && !lessonBody.videoUrl && (
            <Card className="mb-8">
              <CardContent className="py-12 text-center text-muted-foreground">
                No content has been added to this lesson yet.
              </CardContent>
            </Card>
          )}

          {/* Quiz Section */}
          {quiz && enrolled && currentUserId && (
            <QuizSection
              quiz={quiz}
              bestAttempt={bestAttempt}
              quizResult={quizResult}
              quizFetcher={quizFetcher}
              isSubmitting={isSubmittingQuiz}
            />
          )}

          {/* Mark Complete / Up Next */}
          {enrolled && currentUserId && (
            <LessonCompletion
              courseSlug={course.slug}
              lessonId={lesson.id}
              lessonStatus={lessonStatus}
              nextLesson={nextLesson}
            />
          )}

          {/* Questions & Discussion — confidential to people with access */}
          {canViewContent && (
            <CommentThread
              comments={comments}
              currentUserId={currentUserId}
              canModerate={canModerate}
              canPost
              instructorName={instructorName}
            />
          )}

          {/* Prev/Next Navigation */}
          <LessonPager
            course={course}
            prevLesson={prevLesson}
            nextLesson={nextLesson}
          />
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this lesson.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Lesson not found";
      message =
        "The lesson you're looking for doesn't exist or may have been removed.";
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
          <Link to="/dashboard">
            <Button>My Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
