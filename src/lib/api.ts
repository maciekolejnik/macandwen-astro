/**
 * Small helpers so every JSON route answers in the same shape: `{ error }` on
 * failure, the payload itself on success. Written out rather than pulled from a
 * framework because there are only a handful of routes.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // These answers are per-visitor and never worth storing.
      'cache-control': 'private, no-store',
    },
  });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

/**
 * A body that is not JSON, or not an object, is a client mistake rather than a
 * server failure, so it must not reach the route as an exception.
 *
 * The content type is checked, not just the parse: `text/plain` makes a
 * cross-origin POST a "simple" request that skips the preflight, so insisting
 * on JSON keeps CORS in play. The session cookie's `SameSite=Lax` already
 * blocks the same attack, but neither should be the only thing standing there.
 */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.split(';')[0].trim().endsWith('json')) return null;

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
