import { useEffect } from "react";
import type { FetcherWithComponents } from "react-router";
import { toast } from "sonner";

/**
 * Toast the outcome of a course editor edit once its fetcher settles:
 * `successMessage` when the action saved, the refusal when it returned one.
 */
export function useFetcherToast(
  fetcher: Pick<
    FetcherWithComponents<{ success?: boolean; error?: string } | undefined>,
    "state" | "data"
  >,
  successMessage: string
) {
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(successMessage);
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, successMessage]);
}
