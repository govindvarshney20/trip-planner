import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { fetchStopDetail, sanitizeStopDetail } from '@/lib/itinerary';
import type { PlanStop } from '@/lib/types';

export const maxDuration = 60;

/**
 * Deep detail for one stop, fetched on demand and then cached on the row.
 *
 * This is the half of the design that keeps the plan fast: the itinerary is one
 * Gemini call, and the expensive per-place research only happens for the stops
 * someone actually opens. Cached forever after the first open, so a group of
 * four pays for it once.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ code: string; stopId: string }> },
) {
  return guard(async () => {
    const { code, stopId } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    // Scope the lookup to this trip so a stop id from another trip cannot be
    // fetched by guessing.
    const { data: stop, error } = await db()
      .from('plan_stops')
      .select('*')
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!stop) return fail('That stop is not on this trip', 404);

    const row = stop as PlanStop;

    if (row.detail && row.detail_fetched_at) {
      // Clean on the way out, so detail cached before the repetition guard
      // existed is fixed on next open without regenerating.
      return ok({
        detail: sanitizeStopDetail(row.detail),
        sources: row.detail_sources,
        grounded: row.detail_grounded,
        cached: true,
      });
    }

    const result = await fetchStopDetail(trip, {
      title: row.title,
      locality: row.locality,
      kind: row.kind,
    });

    const { error: saveErr } = await db()
      .from('plan_stops')
      .update({
        detail: result.data,
        detail_sources: result.sources,
        detail_grounded: result.grounded,
        detail_fetched_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (saveErr) throw new Error(saveErr.message);

    return ok({
      detail: result.data,
      sources: result.sources,
      grounded: result.grounded,
      cached: false,
    });
  });
}
