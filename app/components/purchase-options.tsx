import { Users } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsContentNoShift,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import type { TeamPurchaseButtonLabel } from "~/lib/team-purchase";
import { formatPrice } from "~/lib/utils";

/** The purchase page for the course, through sign-up for a signed-out visitor. */
function purchaseLink(slug: string, isSignedIn: boolean, query = "") {
  const purchasePath = `/courses/${slug}/purchase${query}`;
  return isSignedIn
    ? purchasePath
    : `/signup?redirectTo=${encodeURIComponent(purchasePath)}`;
}

/** Buy the course as a Team Purchase, or buy more Coupons for one. */
export function TeamPurchaseButton({
  slug,
  isSignedIn,
  label,
}: {
  slug: string;
  isSignedIn: boolean;
  label: TeamPurchaseButtonLabel | null;
}) {
  return (
    label && (
      <Link to={purchaseLink(slug, isSignedIn, "?mode=team")}>
        <Button variant="outline" className="w-full">
          <Users className="mr-2 size-4" />
          {label}
        </Button>
      </Link>
    )
  );
}

/** The price, with any PPP discount, and the ways to buy the course. */
export function PurchaseOptions({
  slug,
  price,
  pppPrice,
  tierLabel,
  isSignedIn,
  teamPurchaseButtonLabel,
}: {
  slug: string;
  price: number;
  pppPrice: number;
  tierLabel: string;
  isSignedIn: boolean;
  teamPurchaseButtonLabel: TeamPurchaseButtonLabel | null;
}) {
  const pppPriceLabel = formatPrice(pppPrice);
  const isDiscounted = pppPrice < price;

  const priceDisplay = (
    <div className="mb-3 text-center">
      {isDiscounted ? (
        <>
          <div className="text-sm text-muted-foreground line-through">
            {formatPrice(price)}
          </div>
          <div className="text-2xl font-bold">{pppPriceLabel}</div>
          <div className="mt-1 inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
            {tierLabel} — PPP discount
          </div>
        </>
      ) : (
        <div className="text-2xl font-bold">{pppPriceLabel}</div>
      )}
    </div>
  );

  return (
    <>
      <Tabs defaultValue="self">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="self" className="flex-1 text-xs">
            Buy for Myself
          </TabsTrigger>
          <TabsTrigger value="team" className="flex-1 text-xs">
            Buy for Team
          </TabsTrigger>
        </TabsList>
        <TabsContentNoShift>
          <TabsContent value="self" forceMount>
            {priceDisplay}
            <Link to={purchaseLink(slug, isSignedIn)}>
              <Button size="lg" className="w-full">
                Enroll Now — {pppPriceLabel}
              </Button>
            </Link>
          </TabsContent>
          <TabsContent value="team" forceMount>
            {priceDisplay}
            <Link to={purchaseLink(slug, isSignedIn, "?mode=team")}>
              <Button size="lg" variant="outline" className="w-full">
                Buy for Your Team
              </Button>
            </Link>
          </TabsContent>
        </TabsContentNoShift>
      </Tabs>
      <TeamPurchaseButton
        slug={slug}
        isSignedIn={isSignedIn}
        label={teamPurchaseButtonLabel}
      />
    </>
  );
}
