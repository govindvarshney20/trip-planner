import { cookies } from 'next/headers';
import { db } from './supabase';
import { hashSecret } from './codes';
import type { Member } from './types';

/**
 * Membership is proven by a per-trip httpOnly cookie holding the member's raw
 * secret. We hash it and look for a matching, non-removed member row. This is
 * the single chokepoint every mutating route goes through.
 */

const ONE_YEAR = 60 * 60 * 24 * 365;

export function memberCookieName(tripId: string): string {
  return `wf_m_${tripId}`;
}

export async function setMemberCookie(tripId: string, secret: string): Promise<void> {
  const jar = await cookies();
  jar.set(memberCookieName(tripId), secret, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  });
}

export async function clearMemberCookie(tripId: string): Promise<void> {
  const jar = await cookies();
  jar.delete(memberCookieName(tripId));
}

/** Returns the signed-in member for this trip, or null. */
export async function getCurrentMember(tripId: string): Promise<Member | null> {
  const jar = await cookies();
  const secret = jar.get(memberCookieName(tripId))?.value;
  if (!secret) return null;

  const { data, error } = await db()
    .from('members')
    .select('*')
    .eq('trip_id', tripId)
    .eq('secret_hash', hashSecret(secret))
    .eq('removed', false)
    .maybeSingle();

  if (error || !data) return null;
  return data as Member;
}

/** Throwing variant for route handlers that must have a member. */
export async function requireMember(tripId: string): Promise<Member> {
  const member = await getCurrentMember(tripId);
  if (!member) throw new UnauthorizedError();
  return member;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('You are not a member of this trip');
    this.name = 'UnauthorizedError';
  }
}

/** Best-effort presence ping; never blocks a request. */
export async function touchMember(memberId: string): Promise<void> {
  await db()
    .from('members')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', memberId);
}
