import { Card, CardContent } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { AnalyticsPage } from "~/modules/instructor-analytics/index.server";

import { CourseProgress } from "./course-progress";
import { DropOffFunnel } from "./drop-off-funnel";
import { QuizPassRates } from "./quiz-pass-rates";
import { RevenueByCountry } from "./revenue-by-country";
import { RevenueByCourse } from "./revenue-by-course";

/** The Course detail tab: one course's progress, drop-off, quizzes and sales. */
export function CourseDetailTab({
  selectedCourseId,
  courseOptions,
  progress,
  funnel,
  quizzes,
  countries,
  courses,
  fullyRefundedCourseIds,
  summary,
  onSelectCourse,
}: Pick<
  AnalyticsPage,
  | "selectedCourseId"
  | "courseOptions"
  | "progress"
  | "funnel"
  | "quizzes"
  | "countries"
  | "courses"
  | "fullyRefundedCourseIds"
  | "summary"
> & {
  /** Null means all courses. */
  onSelectCourse: (courseId: string | null) => void;
}) {
  const selectedCourse =
    courseOptions.find((course) => course.courseId === selectedCourseId) ??
    null;
  // The revenue table narrows to the selected course. One with no sales in the
  // range has no row at all, and the panel says so rather than sitting empty.
  const revenueRows = selectedCourse
    ? courses.filter((course) => course.courseId === selectedCourseId)
    : courses;
  // An empty table means either no sales or sales that were all Refunded. For
  // every course, the summary already tells them apart: with nothing kept, any
  // Refund means every sale was Refunded.
  const revenueRowsAllRefunded = selectedCourse
    ? fullyRefundedCourseIds.includes(selectedCourse.courseId)
    : summary.refundCount > 0;

  return (
    <>
      <Select
        value={selectedCourse ? String(selectedCourse.courseId) : "all"}
        onValueChange={(value) =>
          onSelectCourse(value === "all" ? null : value)
        }
      >
        <SelectTrigger aria-label="Course" className="w-72">
          <SelectValue>{selectedCourse?.title ?? "All courses"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All courses</SelectItem>
          {courseOptions.map((course) => (
            <SelectItem key={course.courseId} value={String(course.courseId)}>
              {course.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {progress && funnel ? (
        progress.enrolledCount === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="font-medium">Nobody is enrolled yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Progress and drop-off appear as soon as the first student joins{" "}
                {selectedCourse?.title}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <CourseProgress progress={progress} />

            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold">Drop-off</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  How many of the {funnel.enrolledCount} enrolled{" "}
                  {funnel.enrolledCount === 1 ? "student" : "students"} got at
                  least as far as each lesson, all time. The bars only descend,
                  so the biggest gap is where students quit — the figure beside
                  a lesson counts the ones who never reached it, having stopped
                  on the lesson above.
                </p>
                <DropOffFunnel funnel={funnel} />
              </CardContent>
            </Card>
          </>
        )
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Pick a course</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {courseOptions.length === 0
                ? "There are no courses here to look into yet."
                : "Choose one of your courses above to see how far students get and where they give up."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Both panels sit outside the enrolment gate above: a quiz with
          nobody enrolled to sit it, and money arriving before anybody
          redeems their Coupon, are things an instructor should still be
          told about rather than shown one "nobody is enrolled" card in
          place of. */}
      {quizzes && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold">Quiz results</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              One result per student per quiz, counting their best attempt — the
              same basis as the student roster. Retakes are not counted
              separately, so a quiz people get on the second go still reads as
              passed. Attempts made in this period only.
            </p>
            <QuizPassRates quizzes={quizzes} />
          </CardContent>
        </Card>
      )}

      {countries && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold">Revenue by country</h2>
            <RevenueByCountry breakdown={countries} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <RevenueByCourse
            rows={revenueRows}
            isAllRefunded={revenueRowsAllRefunded}
          />
        </CardContent>
      </Card>
    </>
  );
}
