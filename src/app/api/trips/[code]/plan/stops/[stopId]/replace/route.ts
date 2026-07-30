import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import type { PlanStop, StopAlternative } from '@/lib/types';

const Body = z.object({ alternativeId: z.string().uuid() });

/**
 * Swap a stop's content for one of its alternatives, in place.
 *
 * The stop keeps its position in the day, but everything else is replaced and
 * the caches/votes for the old place are cleared -- ratings and votes were
 * about the thing that is no longer there.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; stopId: string }> },
) {
  return guard(async () => {
    const { code, stopId } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');

    const { data: stop } = await db()
      .from('plan_stops')
      .select('id')
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .maybeSingle();
    if (!stop) return fail('That stop is not on this trip', 404);

    // The alternative must belong to this stop, so one stop's id can't pull in
    // another stop's alternative.
    const { data: alt } = await db()
      .from('stop_alternatives')
      .select('*')
      .eq('id', parsed.data.alternativeId)
      .eq('stop_id', stopId)
      .maybeSingle();
    if (!alt) return fail('That alternative is not for this stop', 404);
    const a = alt as StopAlternative;

    const { data: updated, error } = await db()
      .from('plan_stops')
      .update({
        title: a.title,
        locality: a.locality,
        summary: a.summary,
        why_included: a.why ?? 'Swapped in by the group.',
        duration_hours: a.duration_hours,
        cost_note: a.cost_note,
        // The old place's research and votes no longer apply.
        detail: null,
        detail_sources: [],
        detail_grounded: false,
        detail_fetched_at: null,
      })
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Clear votes on the old place, and the now-stale alternatives.
    await db().from('stop_votes').delete().eq('stop_id', stopId);
    await db().from('stop_alternatives').delete().eq('stop_id', stopId);

    return ok({ stop: updated as PlanStop });
  });
}
