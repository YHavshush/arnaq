/** The four main tabs, left to right: the order the bottom bar shows and the order swiping follows. */
export const TAB_HREFS = ["/", "/forecast", "/fixed-costs", "/upload"] as const;

export const isTabActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

/** Which main tab a path belongs to (a sub-page counts for its tab), or -1 for any other page. */
export const tabIndexOf = (path: string) => TAB_HREFS.findIndex((href) => isTabActive(path, href));

/** The event the page sends when a swipe has chosen a tab, so the bar's pill can start moving at once. */
export const TAB_EVENT = "arnaq:tab";
