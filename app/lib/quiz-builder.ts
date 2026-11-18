import { z } from "zod";

import { QuestionType } from "~/db/schema";

export const quizDraftSchema = z.object({
  title: z.string().trim().min(1, "Quiz title is required."),
  passingScore: z.number(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        type: z.nativeEnum(QuestionType),
        options: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            isCorrect: z.boolean(),
          })
        ),
      })
    )
    .min(1, "At least one question is required."),
});

export type QuizDraft = z.infer<typeof quizDraftSchema>;

export type WizardOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

export type WizardQuestion = {
  id: string;
  text: string;
  type: QuestionType;
  options: WizardOption[];
};

export type WizardState = {
  title: string;
  passingScore: number;
  questions: WizardQuestion[];
};

export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Why the wizard cannot be saved yet. Each error is keyed by the field it is
 * about, so the list can render with stable keys even when two errors share a
 * message.
 */
export function getWizardValidationErrors(wizard: WizardState) {
  const validationErrors: { key: string; message: string }[] = [];
  if (!wizard.title.trim())
    validationErrors.push({
      key: "title",
      message: "Quiz title is required.",
    });
  if (wizard.questions.length === 0)
    validationErrors.push({
      key: "questions",
      message: "At least one question is required.",
    });
  for (const q of wizard.questions) {
    if (!q.text.trim())
      validationErrors.push({
        key: `${q.id}-text`,
        message: `Question ${wizard.questions.indexOf(q) + 1} has no text.`,
      });
    if (q.options.length < 2)
      validationErrors.push({
        key: `${q.id}-options`,
        message: `Question ${wizard.questions.indexOf(q) + 1} needs at least 2 options.`,
      });
    if (!q.options.some((o) => o.isCorrect))
      validationErrors.push({
        key: `${q.id}-correct`,
        message: `Question ${wizard.questions.indexOf(q) + 1} has no correct answer.`,
      });
    for (const opt of q.options) {
      if (!opt.text.trim())
        validationErrors.push({
          key: `${opt.id}-text`,
          message: `Question ${wizard.questions.indexOf(q) + 1} has an empty option.`,
        });
    }
  }
  return validationErrors;
}
