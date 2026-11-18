import { redirect } from "react-router";

import { destroySession } from "~/lib/session";

import type { Route } from "./+types/api.logout";

export async function action({ request }: Route.ActionArgs) {
  const cookie = await destroySession(request);

  return redirect("/", {
    headers: { "Set-Cookie": cookie },
  });
}
