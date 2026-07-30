import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { generateItinerary, usableDays } from '@/lib/itinerary';
import { tripDays } from '@/lib/trip-copy';

export const maxDuration = 60;

/**
 * A claim older than this is assumed dead and may be taken over.
 *
 * Kept just above maxDuration: when the function is killed by the platform the
 * catch block never runs, so the trip is left in 'generating' and only a stale
 * takeover can recover it. Three minutes of staring at a spinner was too long.
 */
const STALE_CLAIM_MS = 75_000;

/** Leave headroom before the platform kills us, so we fail our own way. */
const SELF_DEADLINE_MS = 52_000;

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const deadline = Date.now() + SELF_DEADLINE_MS;

  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    const body = (await req.json().catch(() => ({}))) as { force?: boolean };

    if (body.force) {
      // Rebuild from scratch. Needed to recover a trip whose plan generated
      // badly, and to let a group start over deliberately. Cascades clear the
      // stops, their votes and alternatives.
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

    // Atomically claim the work: generation takes ~30s and several members may
    // open the tab at once. Whoever's UPDATE returns a row owns the job.
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
      const result = await generateItinerary(trip, dna.respondents > 0 ? dna : null, {
        deadline,
      });

      const expected = tripDays(trip) ?? 7;
      // usableDays drops malformed indices, de-duplicates, and — critically —
      // discards days with no stops.
      const days = usableDays(result.data.days ?? [], expected);

      // A plan without stops is a table of contents, not an itinerary. Marking
      // that 'ready' is what put "9 days · 0 stops" in front of a user, so this
      // fails loudly instead and the UI offers a retry.
      if (days.length === 0) {
        throw new Error('The model returned no days with any stops in them');
      }

      const { error: dayErr } = await db().from('trip_days').insert(
        days.map((d) => ({
          trip_id: trip.id,
          day_index: d.day_index,
          title: d.title,
          locality: d.locality ?? null,
          summary: d.summary ?? null,
          warnings: d.warnings ?? [],
        })),
      );
      if (dayErr) throw new Error(dayErr.message);

      const stops = days.flatMap((d) =>
        (d.stops ?? []).map((s, i) => ({
          trip_id: trip.id,
          day_index: d.day_index,
          // Spaced so a later reorder can slot between two stops without
          // rewriting the whole day.
          position: (i + 1) * 100,
          title: s.title,
          kind: s.kind ?? 'activity',
          locality: s.locality ?? d.locality ?? null,
          summary: s.summary ?? null,
          why_included: s.why_included ?? null,
          duration_hours: typeof s.duration_hours === 'number' ? s.duration_hours : null,
          cost_note: s.cost_note ?? null,
          best_time: s.best_time ?? null,
        })),
      );

      // usableDays guarantees every day has stops, so an empty batch here means
      // something upstream changed and the guarantee broke.
      if (stops.length === 0) throw new Error('No stops to insert');

      const { error: stopErr } = await db().from('plan_stops').insert(stops);
      if (stopErr) throw new Error(stopErr.message);

      await db().from('trips').update({ plans_state: 'ready' }).eq('id', trip.id);

      return ok({
        state: 'ready',
        days: days.length,
        stops: stops.length,
        grounded: result.grounded,
      });
    } catch (err) {
      // Release the claim so a retry is possible rather than wedging the trip
      // in 'generating' forever.
      await db().from('trips').update({ plans_state: 'failed' }).eq('id', trip.id);
      throw err;
    }
  });
}
