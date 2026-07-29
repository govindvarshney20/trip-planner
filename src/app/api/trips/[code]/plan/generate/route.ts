import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { generateItinerary } from '@/lib/itinerary';
import { tripDays } from '@/lib/trip-copy';

export const maxDuration = 60;

/** A claim older than this is assumed dead and may be taken over. */
const STALE_CLAIM_MS = 3 * 60 * 1000;

export async function POST(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

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
      const result = await generateItinerary(trip, dna.respondents > 0 ? dna : null);

      const expected = tripDays(trip) ?? 7;
      const days = (result.data.days ?? [])
        .filter((d) => Number.isInteger(d.day_index) && d.day_index >= 0 && d.day_index < expected)
        // The model occasionally repeats a day_index; the table's primary key
        // would reject the batch, so drop duplicates rather than fail.
        .filter((d, i, arr) => arr.findIndex((x) => x.day_index === d.day_index) === i)
        .sort((a, b) => a.day_index - b.day_index);

      if (days.length === 0) throw new Error('The model returned no usable days');

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

      if (stops.length) {
        const { error: stopErr } = await db().from('plan_stops').insert(stops);
        if (stopErr) throw new Error(stopErr.message);
      }

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
