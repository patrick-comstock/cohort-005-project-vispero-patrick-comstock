import { CheckCircle2, Save, XCircle } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { QuestionType } from "~/db/schema";
import {
  getWizardValidationErrors,
  type WizardState,
} from "~/lib/quiz-builder";

export function ReviewStep({
  wizard,
  isEditing,
  isSaving,
  error,
  onSave,
}: {
  wizard: WizardState;
  isEditing: boolean;
  isSaving: boolean;
  error: string | undefined;
  onSave: () => void;
}) {
  const validationErrors = getWizardValidationErrors(wizard);
  const isValid = validationErrors.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Review Quiz</h2>
          <p className="text-sm text-muted-foreground">
            Review your quiz before saving.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quiz summary */}
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="space-y-1 text-sm">
              <div>
                <span className="font-medium">Title:</span>{" "}
                {wizard.title || "(empty)"}
              </div>
              <div>
                <span className="font-medium">Passing Score:</span>{" "}
                {wizard.passingScore}%
              </div>
              <div>
                <span className="font-medium">Questions:</span>{" "}
                {wizard.questions.length}
              </div>
            </div>
          </div>

          {/* Questions review */}
          {wizard.questions.map((q, idx) => (
            <div key={q.id} className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {idx + 1}
                </span>
                <span className="font-medium">
                  {q.text || "(No question text)"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {q.type === QuestionType.TrueFalse
                    ? "True/False"
                    : "Multiple Choice"}
                </span>
              </div>
              <div className="ml-8 space-y-1">
                {q.options.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2 text-sm">
                    {opt.isCorrect ? (
                      <CheckCircle2 className="size-4 text-green-500" />
                    ) : (
                      <XCircle className="size-4 text-muted-foreground/40" />
                    )}
                    <span
                      className={
                        opt.isCorrect ? "font-medium text-green-700" : ""
                      }
                    >
                      {opt.text || "(empty)"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <p className="mb-2 text-sm font-medium text-destructive">
                Please fix these issues before saving:
              </p>
              <ul className="list-inside list-disc space-y-1 text-sm text-destructive">
                {validationErrors.map((validationError) => (
                  <li key={validationError.key}>{validationError.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3">
            <Button disabled={!isValid || isSaving} onClick={onSave}>
              <Save className="mr-1.5 size-4" />
              {isSaving
                ? "Saving..."
                : isEditing
                  ? "Update Quiz"
                  : "Create Quiz"}
            </Button>

            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
