import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { generateAlternatives } from '@/lib/itinerary';
import type { PlanStop, StopAlternative } from '@/lib/types';

export const maxDuration = 60;

/**
 * Alternatives for a stop. GET returns any already generated; POST generates a
 * fresh set (grounded) and replaces the stored ones.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string; stopId: string }> },
) {
  return guard(async () => {
    const { code, stopId } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);
    await requireMember(trip.id);

    const { data, error } = await db()
      .from('stop_alternatives')
      .select('*')
      .eq('stop_id', stopId)
      .order('created_at');
    if (error) throw new Error(error.message);

    return ok({ alternatives: (data ?? []) as StopAlternative[] });
  });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ code: string; stopId: string }> },
) {
  return guard(async () => {
    const { code, stopId } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);
    await requireMember(trip.id);

    const { data: stop } = await db()
      .from('plan_stops')
      .select('*')
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .maybeSingle();
    if (!stop) return fail('That stop is not on this trip', 404);
    const s = stop as PlanStop;

    const dna = await loadDna(trip.id);
    const result = await generateAlternatives(trip, dna.respondents > 0 ? dna : null, {
      title: s.title,
      locality: s.locality,
      kind: s.kind,
      duration_hours: s.duration_hours,
    });

    if (result.data.length === 0) {
      return ok({ alternatives: [] as StopAlternative[], grounded: result.grounded });
    }

    // Replace any previous set so the list doesn't grow unbounded on re-roll.
    await db().from('stop_alternatives').delete().eq('stop_id', stopId);

    const rows = result.data.map((a) => ({
      stop_id: stopId,
      title: a.title,
      locality: a.locality ?? s.locality ?? null,
      summary: a.summary ?? null,
      why: a.why ?? null,
      duration_hours: typeof a.duration_hours === 'number' ? a.duration_hours : null,
      cost_note: a.cost_note ?? null,
      sources: result.sources,
      grounded: result.grounded,
    }));

    const { data: inserted, error } = await db()
      .from('stop_alternatives')
      .insert(rows)
      .select();
    if (error) throw new Error(error.message);

    return ok({
      alternatives: (inserted ?? []) as StopAlternative[],
      grounded: result.grounded,
    });
  });
}
