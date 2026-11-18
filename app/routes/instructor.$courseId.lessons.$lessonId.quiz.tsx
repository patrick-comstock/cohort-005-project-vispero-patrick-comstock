import { AlertTriangle, ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import { data, isRouteErrorResponse } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AnswersStep } from "~/components/quiz-builder/answers-step";
import { QuestionsStep } from "~/components/quiz-builder/questions-step";
import { ReviewStep } from "~/components/quiz-builder/review-step";
import { SettingsStep } from "~/components/quiz-builder/settings-step";
import {
  LAST_STEP,
  StepIndicator,
} from "~/components/quiz-builder/step-indicator";
import { Button } from "~/components/ui/button";
import { db } from "~/db";
import type { QuestionType } from "~/db/schema";
import {
  generateId,
  type QuizDraft,
  quizDraftSchema,
  type WizardState,
} from "~/lib/quiz-builder";
import {
  deleteQuizForLesson,
  getQuizForLesson,
  requireLessonInCourse,
  saveQuiz,
} from "~/lib/quiz-builder.server";
import { parseFormData, parseParams } from "~/lib/validation";
import { requireCourseManager } from "~/modules/access/index.server";

import type { Route } from "./+types/instructor.$courseId.lessons.$lessonId.quiz";

const quizParamsSchema = z.object({
  courseId: z.coerce.number().int(),
  lessonId: z.coerce.number().int(),
});

const quizActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("save-quiz"),
    wizardData: z.string(),
  }),
  z.object({
    intent: z.literal("delete-quiz"),
  }),
]);

// ─── Meta ───

export function meta({ loaderData }: Route.MetaArgs) {
  const lessonTitle = loaderData?.lesson?.title ?? "Lesson";
  const hasQuiz = !!loaderData?.existingQuiz;
  return [
    {
      title: `${hasQuiz ? "Edit" : "Create"} Quiz: ${lessonTitle} — Cadence`,
    },
  ];
}

// ─── Loader ───

export async function loader({ params, request }: Route.LoaderArgs) {
  const { courseId, lessonId } = parseParams(params, quizParamsSchema);
  const { course } = await requireCourseManager(request, courseId);

  const { lesson, module: mod } = requireLessonInCourse(db, courseId, lessonId);
  const existingQuiz = getQuizForLesson(db, lessonId);

  return { course, lesson, module: mod, existingQuiz };
}

// ─── Action ───

export async function action({ params, request }: Route.ActionArgs) {
  const { courseId, lessonId } = parseParams(params, quizParamsSchema);
  await requireCourseManager(request, courseId);

  requireLessonInCourse(db, courseId, lessonId);

  const formData = await request.formData();
  const parsed = parseFormData(formData, quizActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent } = parsed.data;

  if (intent === "save-quiz") {
    let wizardData: QuizDraft;
    try {
      const raw = JSON.parse(parsed.data.wizardData);
      const wizardResult = quizDraftSchema.safeParse(raw);
      if (!wizardResult.success) {
        return data({ error: "Invalid quiz data." }, { status: 400 });
      }
      wizardData = wizardResult.data;
    } catch {
      return data({ error: "Invalid quiz data." }, { status: 400 });
    }

    saveQuiz(db, lessonId, wizardData);
    return { success: true };
  }

  if (intent === "delete-quiz") {
    deleteQuizForLesson(db, lessonId);
    return { success: true, deleted: true };
  }

  throw data("Invalid action.", { status: 400 });
}

// ─── Component ───

export default function QuizBuilderWizard({
  loaderData,
}: Route.ComponentProps) {
  const { course, lesson, existingQuiz } = loaderData;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const [wizard, setWizard] = useState<WizardState>(() => {
    if (existingQuiz) {
      return {
        title: existingQuiz.title,
        passingScore: Math.round(existingQuiz.passingScore * 100),
        questions: existingQuiz.questions.map((q) => ({
          id: generateId(),
          text: q.questionText,
          type: q.questionType as QuestionType,
          options: q.options.map((o) => ({
            id: generateId(),
            text: o.optionText,
            isCorrect: o.isCorrect,
          })),
        })),
      };
    }
    return {
      title: "",
      passingScore: 70,
      questions: [],
    };
  });

  const isEditing = !!existingQuiz;

  const fetcherData = fetcher.data as
    { success?: boolean; deleted?: boolean; error?: string } | undefined;

  if (fetcher.state === "idle" && fetcherData?.success) {
    if (fetcherData.deleted) {
      toast.success("Quiz deleted.");
      navigate(`/instructor/${course.id}/lessons/${lesson.id}`);
    } else {
      toast.success("Quiz saved.");
      navigate(`/instructor/${course.id}/lessons/${lesson.id}`);
    }
  }

  function canGoNext() {
    if (step === 1) return wizard.title.trim().length > 0;
    if (step === 2) return wizard.questions.length > 0;
    if (step === 3) return true;
    return false;
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${course.id}`} className="hover:text-foreground">
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <Link
          to={`/instructor/${course.id}/lessons/${lesson.id}`}
          className="hover:text-foreground"
        >
          {lesson.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">
          {isEditing ? "Edit Quiz" : "Create Quiz"}
        </span>
      </nav>

      <Link
        to={`/instructor/${course.id}/lessons/${lesson.id}`}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Lesson Editor
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {isEditing ? "Edit Quiz" : "Create Quiz"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lesson: {lesson.title}
          </p>
        </div>
        {isEditing && (
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (
                confirm(
                  "Are you sure you want to delete this quiz? All student attempts will be lost."
                )
              ) {
                fetcher.submit({ intent: "delete-quiz" }, { method: "post" });
              }
            }}
          >
            <Trash2 className="mr-1.5 size-4" />
            Delete Quiz
          </Button>
        )}
      </div>

      <StepIndicator currentStep={step} onStepClick={setStep} />

      {step === 1 && <SettingsStep wizard={wizard} setWizard={setWizard} />}
      {step === 2 && <QuestionsStep wizard={wizard} setWizard={setWizard} />}
      {step === 3 && <AnswersStep wizard={wizard} setWizard={setWizard} />}
      {step === 4 && (
        <ReviewStep
          wizard={wizard}
          isEditing={isEditing}
          isSaving={fetcher.state !== "idle"}
          error={fetcherData?.error}
          onSave={() => {
            fetcher.submit(
              {
                intent: "save-quiz",
                wizardData: JSON.stringify(wizard),
              },
              { method: "post" }
            );
          }}
        />
      )}

      {/* Step navigation */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 1}
        >
          <ArrowLeft className="mr-1.5 size-4" />
          Previous
        </Button>
        {step < LAST_STEP && (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}>
            Next
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the quiz builder.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      message = "The quiz, lesson, or course you're looking for doesn't exist.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
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
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
