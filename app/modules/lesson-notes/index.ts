import { stripRepeatedTitleHeading } from "./lib/strip-repeated-title";

/**
 * The Lesson Notes markdown to show under a lesson, or null when nothing is
 * left to show. The page already shows the title, so a leading heading that
 * only repeats it is dropped.
 */
export function getLessonNotesMarkdown(
  content: string | null,
  lessonTitle: string
): string | null {
  if (!content) return null;
  const notes = stripRepeatedTitleHeading(content, lessonTitle).trim();
  return notes === "" ? null : notes;
}
