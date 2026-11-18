import type { DropResult } from "@hello-pangea/dnd";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  FileText,
  Settings,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { data, isRouteErrorResponse } from "react-router";
import { z } from "zod";

import { ContentTab } from "~/components/course-editor/content-tab";
import { CourseHeader } from "~/components/course-editor/course-header";
import { dragEndSubmission } from "~/components/course-editor/drag-end";
import { SalesCopyTab } from "~/components/course-editor/sales-copy-tab";
import { SettingsTab } from "~/components/course-editor/settings-tab";
import { StudentsTab } from "~/components/course-editor/students-tab";
import { useFetcherToast } from "~/components/course-editor/use-fetcher-toast";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { parseFormData, parseParams } from "~/lib/validation";
import { requireCourseManager } from "~/modules/access/index.server";
import {
  courseEditorIntentSchema,
  editCourse,
  loadCourseEditor,
} from "~/modules/course-editor/index.server";

import type { Route } from "./+types/instructor.$courseId";

const courseEditorParamsSchema = z.object({
  courseId: z.coerce.number().int(),
});

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Edit Course";
  return [
    { title: `Edit: ${title} — Cadence` },
    { name: "description", content: `Edit course: ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { courseId } = parseParams(params, courseEditorParamsSchema);
  await requireCourseManager(request, courseId);

  const page = loadCourseEditor(courseId);
  if (!page) {
    throw data("Course not found.", { status: 404 });
  }
  return page;
}

export async function action({ params, request }: Route.ActionArgs) {
  const { courseId } = parseParams(params, courseEditorParamsSchema);
  const { course } = await requireCourseManager(request, courseId);

  const formData = await request.formData();
  const parsed = parseFormData(formData, courseEditorIntentSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const result = editCourse(course, parsed.data);
  if ("error" in result) {
    return data({ error: result.error }, { status: result.status });
  }
  return result;
}

export default function InstructorCourseEditor({
  loaderData,
}: Route.ComponentProps) {
  const { course, lessonCount, enrollmentCount, students, quizCount } =
    loaderData;
  // These fetchers live here, not in the tabs, so a save still reports its
  // outcome after the Course Manager switches tabs (inactive tabs unmount).
  const statusFetcher = useFetcher();
  const reorderFetcher = useFetcher();
  const lessonReorderFetcher = useFetcher();
  const salesCopyFetcher = useFetcher();
  const priceFetcher = useFetcher();
  const pppFetcher = useFetcher();

  const [salesCopy, setSalesCopy] = useState(course.salesCopy);

  useFetcherToast(statusFetcher, "Course status updated.");
  useFetcherToast(reorderFetcher, "Modules reordered.");
  useFetcherToast(lessonReorderFetcher, "Lessons reordered.");
  useFetcherToast(salesCopyFetcher, "Sales copy saved.");
  useFetcherToast(priceFetcher, "Price updated.");
  useFetcherToast(pppFetcher, "PPP setting updated.");

  function handleSalesCopySave() {
    salesCopyFetcher.submit(
      { intent: "update-sales-copy", salesCopy },
      { method: "post" }
    );
  }

  function handleDragEnd(result: DropResult) {
    const submission = dragEndSubmission(result, course.modules);
    if (!submission) return;
    const fetcher =
      submission.kind === "module" ? reorderFetcher : lessonReorderFetcher;
    fetcher.submit(submission.formData, { method: "post" });
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{course.title}</span>
      </nav>

      <Link
        to="/instructor"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to My Courses
      </Link>

      <CourseHeader
        course={course}
        lessonCount={lessonCount}
        enrollmentCount={enrollmentCount}
      />

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">
            <BookOpen className="size-4" />
            Content
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="sales-copy">
            <FileText className="size-4" />
            Sales Copy
          </TabsTrigger>
          <TabsTrigger value="students">
            <Users className="size-4" />
            Students
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="mt-6">
          <ContentTab course={course} onDragEnd={handleDragEnd} />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <SettingsTab
            course={course}
            onStatusChange={(status) =>
              statusFetcher.submit(
                { intent: "update-status", status },
                { method: "post" }
              )
            }
            onPriceChange={(price) =>
              priceFetcher.submit(
                { intent: "update-price", price },
                { method: "post" }
              )
            }
            onPppToggle={() =>
              pppFetcher.submit(
                {
                  intent: "update-ppp-enabled",
                  pppEnabled: String(!course.pppEnabled),
                },
                { method: "post" }
              )
            }
          />
        </TabsContent>

        <TabsContent value="sales-copy" className="mt-6">
          <SalesCopyTab
            draft={salesCopy}
            savedSalesCopy={course.salesCopy}
            isSaving={salesCopyFetcher.state !== "idle"}
            onDraftChange={setSalesCopy}
            onSave={handleSalesCopySave}
          />
        </TabsContent>

        <TabsContent value="students" className="mt-6">
          <StudentsTab students={students} quizCount={quizCount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the course editor.";

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
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to edit this course.";
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
