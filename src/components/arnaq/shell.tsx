import { Settings } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { userDb } from "@/lib/auth/request";
import { getI18n } from "@/i18n/server";
import { requestTime } from "@/lib/api";
import { getNeedsReview } from "@/lib/categories/categorise";
import { hasSample } from "@/lib/sample/sample";
import { Wordmark } from "./logo";
import { Nav } from "./nav";
import { SampleBanner } from "./sample";
import { ThemeFollower } from "./theme-follower";

/** Open items on Upload: transactions that still need a category. Hidden at zero. */
async function ReviewBadge() {
  await requestTime();
  const { t } = await getI18n();
  let count = 0;
  try {
    count = (await userDb((db) => getNeedsReview(db))).length;
  } catch {
    return null; // a failing badge must not take the whole shell down
  }
  if (count === 0) return null;
  return (
    <span
      aria-label={t.ui.nav.toSort(count)}
      className="num bg-accent text-accent-ink absolute top-0 left-[calc(50%+6px)] rounded-full px-1.5 text-[10.5px] leading-4 font-semibold @min-[900px]/app:static @min-[900px]/app:ml-auto"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The sample-data notice, on every screen while there is sample data in the account. */
async function SampleNotice() {
  await requestTime();
  let sample = false;
  try {
    sample = await userDb((db) => hasSample(db));
  } catch {
    return null; // a failing notice must not take the whole shell down
  }
  return sample ? <SampleBanner /> : null;
}

/** One adaptive layout: sidebar and two columns when the app is 900px wide, pill nav below that. */
export async function AppShell({ children }: { children: ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="@container/app min-h-dvh">
      <ThemeFollower />
      <a
        href="#main"
        className="bg-accent text-accent-ink sr-only z-40 rounded-full px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t.ui.skipToContent}
      </a>
      <div className="@min-[900px]/app:grid @min-[900px]/app:grid-cols-[240px_minmax(0,1fr)]">
        <Nav
          badge={
            <Suspense fallback={null}>
              <ReviewBadge />
            </Suspense>
          }
        />
        <div className="mx-auto w-full max-w-[760px] px-4 pt-3 pb-36 @min-[900px]/app:max-w-[1040px] @min-[900px]/app:px-8 @min-[900px]/app:pt-6 @min-[900px]/app:pb-14">
          <div className="flex items-center justify-between pb-2">
            <Wordmark title={t.ui.brand} className="h-5 w-auto @min-[900px]/app:invisible" />
            <div className="flex gap-2">
              <Link
                href="/settings"
                aria-label={t.ui.nav.settings}
                className="glass grid size-11 place-items-center rounded-full"
              >
                <Settings className="size-[18px]" />
              </Link>
            </div>
          </div>
          <Suspense fallback={null}>
            <SampleNotice />
          </Suspense>
          <main id="main">{children}</main>
        </div>
      </div>
    </div>
  );
}
