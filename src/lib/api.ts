import { NextResponse } from 'next/server';
import { db } from './supabase';
import { normalizeJoinCode } from './codes';
import { computeGroupDna, type GroupDna } from './dna';
import { tallyVotes } from './plans';
import type { Member, Plan, PlanDay, PlanVoteView, Preferences, Trip } from './types';

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

/**
 * Plans plus the vote state this member is entitled to see.
 *
 * The blind-voting guarantee is enforced here rather than in the UI. Before
 * reveal the returned object contains no tally and no other member's ranking,
 * so it cannot leak through the page payload.
 */
export async function loadPlans(
  tripId: string,
  memberId: string,
  revealedAt: string | null,
): Promise<{ plans: Plan[]; vote: PlanVoteView }> {
  const [plansRes, membersList, votesRes] = await Promise.all([
    db().from('plans').select('*').eq('trip_id', tripId).order('seed'),
    loadMembers(tripId),
    db().from('plan_votes').select('plan_id, member_id, rank').eq('trip_id', tripId),
  ]);
  if (plansRes.error) throw new DatabaseError(plansRes.error.message);

  const planRows = (plansRes.data ?? []) as Omit<Plan, 'days'>[];
  if (planRows.length === 0) {
    return {
      plans: [],
      vote: { revealed: false, votedCount: 0, totalMembers: membersList.length, myRanking: [] },
    };
  }

  const daysRes = await db()
    .from('plan_days')
    .select('*')
    .in('plan_id', planRows.map((p) => p.id))
    .order('day_index');
  if (daysRes.error) throw new DatabaseError(daysRes.error.message);

  const days = (daysRes.data ?? []) as PlanDay[];
  const plans: Plan[] = planRows.map((p) => ({
    ...p,
    days: days.filter((d) => d.plan_id === p.id),
  }));

  const allVotes = (votesRes.data ?? []) as {
    plan_id: string;
    member_id: string;
    rank: number;
  }[];

  const myRanking = allVotes
    .filter((v) => v.member_id === memberId)
    .sort((a, b) => a.rank - b.rank)
    .map((v) => v.plan_id);

  const votedCount = new Set(allVotes.map((v) => v.member_id)).size;
  const revealed = !!revealedAt;

  const vote: PlanVoteView = {
    revealed,
    votedCount,
    totalMembers: membersList.length,
    myRanking,
  };

  if (revealed) {
    vote.results = tallyVotes(planRows.map((p) => p.id), allVotes).map((t) => ({
      planId: t.planId,
      points: t.points,
      firsts: t.firsts,
      noVetoes: t.noVetoes,
    }));
  }

  return { plans, vote };
}

export async function loadDna(tripId: string): Promise<GroupDna> {
  const [members, prefs] = await Promise.all([
    loadMembers(tripId),
    db().from('preferences').select('*').eq('trip_id', tripId),
  ]);
  return computeGroupDna(members, (prefs.data ?? []) as Preferences[]);
}
