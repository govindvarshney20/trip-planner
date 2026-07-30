/**
 * JSON fetch that survives responses which aren't JSON.
 *
 * Our route handlers always return JSON, but the platform in front of them does
 * not: a function timeout, a 502, or a cold-start failure comes back as an HTML
 * or plain-text error page. Calling res.json() on that throws
 * `Unexpected token 'A', "An error o"... is not valid JSON`, which is what the
 * user sees instead of anything actionable.
 */

export class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

/** Turn a non-JSON response into something worth reading. */
function explain(status: number, body: string): string {
  // Vercel's timeout page. The work often completed server-side anyway, so
  // point at the retry rather than implying total failure.
  if (status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed? ?out/i.test(body)) {
    return 'That took longer than the server allows. Try again — it often works on a second attempt.';
  }
  if (status === 502 || status === 503) {
    return 'The server is briefly unavailable. Give it a moment and try again.';
  }
  if (status === 413) return 'That request was too large.';
  if (status >= 500) {
    return 'Something went wrong on our side. Trying again usually sorts it.';
  }
  return `Request failed (${status}).`;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    // Network-level failure: offline, DNS, connection reset.
    throw new RequestError('Could not reach the server. Check your connection.', 0);
  }

  const text = await res.text();

  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RequestError(explain(res.status, text), res.status);
    }
  }

  if (!res.ok) {
    const msg = (parsed as { error?: string } | null)?.error;
    throw new RequestError(msg ?? explain(res.status, text), res.status);
  }

  return parsed as T;
}
