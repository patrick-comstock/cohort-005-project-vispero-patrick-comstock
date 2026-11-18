import { MapPin, ShieldAlert } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { COUNTRIES } from "~/lib/ppp";

function countryName(code: string | null, fallback: string) {
  if (!code) return fallback;
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/**
 * The lesson page's "Access Restricted" screen, shown instead of the lesson to
 * a Student whose PPP-discounted Purchase was made in another country.
 */
export function PppRestrictedScreen({
  courseSlug,
  purchaseCountry,
  currentCountry,
}: {
  courseSlug: string;
  purchaseCountry: string | null;
  currentCountry: string | null;
}) {
  const purchaseCountryName = countryName(
    purchaseCountry,
    "your original country"
  );
  const currentCountryName = countryName(currentCountry, "a different country");

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto mb-4 size-16 text-amber-500" />
        <h1 className="mb-3 text-2xl font-bold">Access Restricted</h1>
        <p className="mb-4 text-muted-foreground">
          You purchased this course with a Purchasing Power Parity discount
          while in <strong>{purchaseCountryName}</strong>, but you're currently
          accessing from <strong>{currentCountryName}</strong>.
        </p>
        <p className="mb-6 text-sm text-muted-foreground">
          PPP-discounted courses can only be accessed from the country where the
          purchase was made. This helps keep courses affordable for students in
          lower-income regions.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to={`/courses/${courseSlug}`}>
            <Button variant="outline">
              <MapPin className="mr-2 size-4" />
              Back to Course
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
