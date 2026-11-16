import { ShieldAlert } from "lucide-react";

/**
 * The short form of the lesson page's "Access Restricted" screen, for pages
 * that show a PPP-blocked Student their Enrollment but not the course content.
 */
export function PppRestrictedNotice() {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm">
      <p className="mb-1 flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 shrink-0 text-amber-500" />
        Access Restricted
      </p>
      <p className="text-muted-foreground">
        PPP-discounted courses can only be accessed from the country where the
        purchase was made.
      </p>
    </div>
  );
}
