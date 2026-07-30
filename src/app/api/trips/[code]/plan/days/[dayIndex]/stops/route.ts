import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { generateDayStops } from '@/lib/itinerary';
import type { PlanStop, TripDay } from '@/lib/types';

export const maxDuration = 60;

/**
 * Generate and store one day's stops.
 *
 * The browser calls this once per day after the skeleton is up, a few at a
 * time. Each call has a whole 60s budget for a single day's grounded research,
 * which is far more than it needs -- so no request can time out the way a
 * whole-trip generation did.
 *
 * Idempotent: if the day already has stops it returns them, so a double-tap or
 * a retry never duplicates a day.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ code: string; dayIndex: string }> },
) {
  return guard(async () => {
    const { code, dayIndex } = await ctx.params;
    const day_index = Number(dayIndex);
    if (!Number.isInteger(day_index) || day_index < 0) return fail('Bad day', 400);

    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    const { data: dayRow, error: dayErr } = await db()
      .from('trip_days')
      .select('*')
      .eq('trip_id', trip.id)
      .eq('day_index', day_index)
      .maybeSingle();
    if (dayErr) throw new Error(dayErr.message);
    if (!dayRow) return fail('That day is not part of this trip', 404);

    // Already filled? Return what's there rather than generating again.
    const { data: existing, error: exErr } = await db()
      .from('plan_stops')
      .select('*')
      .eq('trip_id', trip.id)
      .eq('day_index', day_index)
      .neq('status', 'removed')
      .order('position');
    if (exErr) throw new Error(exErr.message);
    if (existing && existing.length > 0) {
      return ok({ day_index, stops: existing as PlanStop[], cached: true });
    }

    const day = dayRow as TripDay;
    const dna = await loadDna(trip.id);
    const result = await generateDayStops(trip, dna.respondents > 0 ? dna : null, {
      day_index: day.day_index,
      title: day.title,
      locality: day.locality,
      summary: day.summary,
    });

    if (result.data.length === 0) {
      // Leave the day empty rather than storing nothing; the client shows a
      // per-day retry. Not an error the whole plan should fail on.
      return ok({ day_index, stops: [] as PlanStop[], grounded: result.grounded, empty: true });
    }

    const rows = result.data.map((s, i) => ({
      trip_id: trip.id,
      day_index,
      // Spaced by 100 so a later reorder can slot between two stops.
      position: (i + 1) * 100,
      title: s.title,
      kind: s.kind ?? 'activity',
      locality: s.locality ?? day.locality ?? null,
      summary: s.summary ?? null,
      why_included: s.why_included ?? null,
      duration_hours: typeof s.duration_hours === 'number' ? s.duration_hours : null,
      cost_note: s.cost_note ?? null,
      best_time: s.best_time ?? null,
    }));

    const { data: inserted, error: insErr } = await db()
      .from('plan_stops')
      .insert(rows)
      .select();
    if (insErr) throw new Error(insErr.message);

    return ok({
      day_index,
      stops: (inserted ?? []) as PlanStop[],
      grounded: result.grounded,
    });
  });
}
