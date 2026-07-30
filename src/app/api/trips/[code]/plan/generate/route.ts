import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { generateSkeleton } from '@/lib/itinerary';

export const maxDuration = 60;

/**
 * A claim older than this is assumed dead and may be taken over. Kept just above
 * maxDuration: if the platform kills the function the catch never runs, so only
 * a stale takeover can recover the trip.
 */
const STALE_CLAIM_MS = 75_000;

/**
 * Builds the day-level frame only -- fast, ungrounded -- and marks the trip
 * ready. The per-day stops are filled by separate requests
 * (/plan/days/[dayIndex]/stops) that the browser fires once the frame is up.
 * This is what keeps any single request well inside the 60s limit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    const body = (await req.json().catch(() => ({}))) as { force?: boolean };

    if (body.force) {
      // Rebuild from scratch: clear days and stops (cascades take votes and
      // alternatives). Needed to recover a bad plan or start over.
      const { error: delDays } = await db().from('trip_days').delete().eq('trip_id', trip.id);
      if (delDays) throw new Error(delDays.message);
      const { error: delStops } = await db().from('plan_stops').delete().eq('trip_id', trip.id);
      if (delStops) throw new Error(delStops.message);
      await db().from('trips').update({ plans_state: 'none' }).eq('id', trip.id);
      trip.plans_state = 'none';
    }

    if (trip.plans_state === 'ready') {
      return ok({ state: 'ready', message: 'Plan already exists' });
    }

    // Atomically claim the work so concurrent openers produce one skeleton.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { data: claimed, error: claimErr } = await db()
      .from('trips')
      .update({ plans_state: 'generating', plans_claimed_at: new Date().toISOString() })
      .eq('id', trip.id)
      .or(
        `plans_state.eq.none,plans_state.eq.failed,and(plans_state.eq.generating,plans_claimed_at.lt.${staleBefore})`,
      )
      .select()
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) {
      return ok({ state: 'generating', message: 'Already being generated' }, { status: 202 });
    }

    try {
      // Preferences are additive -- the first plan is built before anyone has
      // filled them in and must be good without them.
      const dna = await loadDna(trip.id);
      const frame = await generateSkeleton(trip, dna.respondents > 0 ? dna : null);

      if (frame.length === 0) throw new Error('Could not lay out the days');

      const { error: dayErr } = await db().from('trip_days').insert(
        frame.map((d) => ({
          trip_id: trip.id,
          day_index: d.day_index,
          title: d.title,
          locality: d.locality ?? null,
          summary: d.summary ?? null,
          warnings: d.warnings ?? [],
        })),
      );
      if (dayErr) throw new Error(dayErr.message);

      await db().from('trips').update({ plans_state: 'ready' }).eq('id', trip.id);

      return ok({ state: 'ready', days: frame.length });
    } catch (err) {
      // Release the claim so a retry is possible rather than wedging 'generating'.
      await db().from('trips').update({ plans_state: 'failed' }).eq('id', trip.id);
      throw err;
    }
  });
}
