import { describe, expect, it } from "vitest";

import { createFeedback, feedback, type RunCommand } from "../index.server";

const ISSUE_URL = "https://github.com/alice/cadence/issues/7";

function fakeRun(origin: string) {
  const calls: { command: string; args: string[] }[] = [];
  const run: RunCommand = async (command, args) => {
    calls.push({ command, args });
    return command === "git" ? `${origin}\n` : `${ISSUE_URL}\n`;
  };
  return { run, calls };
}

function feedbackRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    body,
  });
}

const validFields = {
  title: "My long note disappeared",
  description: "I clicked Save and the note was gone.",
  page: "/courses/typescript/lessons/3",
};

describe("fileIssue", () => {
  it("files the feedback on origin's repo and returns the issue URL", async () => {
    const { run, calls } = fakeRun("git@github.com:alice/cadence.git");
    const feedback = createFeedback({ isDev: true, run });

    const result = await feedback.fileIssue(feedbackRequest(validFields));

    expect(result).toEqual({ issueUrl: ISSUE_URL });
    expect(calls).toEqual([
      { command: "git", args: ["remote", "get-url", "origin"] },
      {
        command: "gh",
        args: [
          "issue",
          "create",
          "--repo",
          "alice/cadence",
          "--title",
          "My long note disappeared",
          "--body",
          "_Sent from the feedback button on `/courses/typescript/lessons/3`._\n\nI clicked Save and the note was gone.\n",
        ],
      },
    ]);
  });

  it.each([
    "https://github.com/alice/cadence.git",
    "https://github.com/alice/cadence",
    "ssh://git@github.com/alice/cadence.git",
  ])("reads the repo from an origin of %s", async (origin) => {
    const { run, calls } = fakeRun(origin);

    await createFeedback({ isDev: true, run }).fileIssue(
      feedbackRequest(validFields)
    );

    expect(calls[1].args.slice(2, 4)).toEqual(["--repo", "alice/cadence"]);
  });

  it("throws 404 and runs nothing outside dev", async () => {
    const { run, calls } = fakeRun("git@github.com:alice/cadence.git");

    const thrown = await createFeedback({ isDev: false, run })
      .fileIssue(feedbackRequest(validFields))
      .catch((error) => error);

    expect(thrown).toMatchObject({ init: { status: 404 }, data: "Not found" });
    expect(calls).toEqual([]);
  });

  it("names the page as / when the form does not say which page", async () => {
    const { run, calls } = fakeRun("git@github.com:alice/cadence.git");
    const { title, description } = validFields;

    await createFeedback({ isDev: true, run }).fileIssue(
      feedbackRequest({ title, description })
    );

    expect(calls[1].args.at(-1)).toBe(
      "_Sent from the feedback button on `/`._\n\nI clicked Save and the note was gone.\n"
    );
  });

  it("throws 400 for a blank description", async () => {
    const { run } = fakeRun("git@github.com:alice/cadence.git");

    const thrown = await createFeedback({ isDev: true, run })
      .fileIssue(feedbackRequest({ ...validFields, description: " " }))
      .catch((error) => error);

    expect(thrown).toMatchObject({
      init: { status: 400 },
      data: "Say what happened.",
    });
  });

  it("names every missing field when both are blank", async () => {
    const { run } = fakeRun("git@github.com:alice/cadence.git");

    const thrown = await createFeedback({ isDev: true, run })
      .fileIssue(feedbackRequest({ title: "", description: "" }))
      .catch((error) => error);

    expect(thrown).toMatchObject({
      data: "Give the feedback a title. Say what happened.",
    });
  });

  it("is live in the app's own dev build", async () => {
    const thrown = await feedback
      .fileIssue(feedbackRequest({ title: "", description: "" }))
      .catch((error) => error);

    expect(thrown).toMatchObject({ init: { status: 400 } });
  });

  it("throws 400 and runs nothing for a blank title", async () => {
    const { run, calls } = fakeRun("git@github.com:alice/cadence.git");

    const thrown = await createFeedback({ isDev: true, run })
      .fileIssue(feedbackRequest({ ...validFields, title: "   " }))
      .catch((error) => error);

    expect(thrown).toMatchObject({
      init: { status: 400 },
      data: "Give the feedback a title.",
    });
    expect(calls).toEqual([]);
  });

  it("throws 500 and never calls gh when origin is not on GitHub", async () => {
    const { run, calls } = fakeRun("https://gitlab.com/alice/cadence.git");

    const thrown = await createFeedback({ isDev: true, run })
      .fileIssue(feedbackRequest(validFields))
      .catch((error) => error);

    expect(thrown).toMatchObject({
      init: { status: 500 },
      data: "origin is not a GitHub repo: https://gitlab.com/alice/cadence.git",
    });
    expect(calls.map((call) => call.command)).toEqual(["git"]);
  });
});
