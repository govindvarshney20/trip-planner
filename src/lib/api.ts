import { NextResponse } from 'next/server';
import { db } from './supabase';
import { normalizeJoinCode } from './codes';
import { computeGroupDna, type GroupDna } from './dna';
import type { Member, Preferences, Trip } from './types';

/**
 * Shared plumbing for route handlers.
 *
 * A trip is addressed in URLs by either its join code or its invite token, so
 * a link and a spoken code both resolve the same way.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a handler so thrown errors become clean JSON instead of a stack trace. */
export async function guard<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'UnauthorizedError') return fail('You are not a member of this trip', 403);
    if (name === 'DatabaseError') {
      console.error('[wayfare]', err);
      return fail('We cannot reach the database right now. Please try again in a moment.', 503);
    }

    const message = (err as Error)?.message ?? 'Something went wrong';

    // Missing configuration is by far the most common failure in a fresh
    // clone, so say so explicitly rather than returning a generic 500.
    if (message.includes('is not set')) {
      return fail(`Server is not configured: ${message}`, 500);
    }

    // Reaching Supabase can fail for reasons that are not the caller's fault
    // and will pass on retry. Those deserve a 503, not a 500 -- the difference
    // is "try again" versus "something is broken".
    if (
      /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|not in allowlist/i.test(message)
    ) {
      console.error('[wayfare]', err);
      return fail('We cannot reach the database right now. Please try again in a moment.', 503);
    }
    console.error('[wayfare]', err);
    return fail(message, 500);
  }
}

/** Raised when the database itself is unreachable or erroring. */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(`Database unavailable: ${message}`);
    this.name = 'DatabaseError';
  }
}

export async function loadTrip(codeOrToken: string): Promise<Trip | null> {
  const raw = decodeURIComponent(codeOrToken).trim();
  if (!raw) return null;

  // A failed query and a genuinely missing trip must not look the same: one is
  // "check your link", the other is "our database is down". Collapsing them
  // sends users hunting for a typo during an outage.
  const byToken = await db().from('trips').select('*').eq('invite_token', raw).maybeSingle();
  if (byToken.error) throw new DatabaseError(byToken.error.message);
  if (byToken.data) return byToken.data as Trip;

  const byCode = await db()
    .from('trips')
    .select('*')
    .eq('join_code', normalizeJoinCode(raw))
    .maybeSingle();
  if (byCode.error) throw new DatabaseError(byCode.error.message);

  return (byCode.data as Trip) ?? null;
}

export async function loadMembers(tripId: string): Promise<Member[]> {
  const { data } = await db()
    .from('members')
    .select('*')
    .eq('trip_id', tripId)
    .eq('removed', false)
    .order('created_at');
  return (data ?? []) as Member[];
}

export async function loadDna(tripId: string): Promise<GroupDna> {
  const [members, prefs] = await Promise.all([
    loadMembers(tripId),
    db().from('preferences').select('*').eq('trip_id', tripId),
  ]);
  return computeGroupDna(members, (prefs.data ?? []) as Preferences[]);
}
