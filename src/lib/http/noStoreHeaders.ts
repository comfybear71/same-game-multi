/** Headers that prevent browser *and* Vercel edge CDN from caching auth'd API JSON. */
export const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
};
