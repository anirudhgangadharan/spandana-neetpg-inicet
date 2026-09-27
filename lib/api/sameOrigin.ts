/** A mutation must originate from the app, not from another website. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    const submittedOrigin = new URL(origin).origin;
    if (submittedOrigin === new URL(request.url).origin) return true;

    // Reverse proxies can expose an internal request URL to Next.js while the
    // browser correctly sends the public origin. AUTH_URL is the operator-set
    // canonical origin and is safer than trusting forwarded host headers.
    const canonicalUrl = process.env.AUTH_URL;
    return canonicalUrl !== undefined && submittedOrigin === new URL(canonicalUrl).origin;
  } catch {
    return false;
  }
}
