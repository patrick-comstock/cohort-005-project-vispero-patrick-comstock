import { data } from "react-router";

import { feedback } from "~/modules/feedback/index.server";

import type { Route } from "./+types/api.feedback";

export function loader() {
  throw data("Not found", { status: 404 });
}

export async function action({ request }: Route.ActionArgs) {
  return feedback.fileIssue(request);
}
