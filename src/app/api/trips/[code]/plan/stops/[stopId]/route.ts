import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import type { PlanStop } from '@/lib/types';

/**
 * Edit a stop, or change its status (remove / restore).
 *
 * Removing sets status='removed' rather than deleting, so it can be undone and
 * so its votes survive if the group changes its mind. loadItinerary filters
 * removed stops out of the plan.
 */
const Body = z.object({
  status: z.enum(['proposed', 'accepted', 'removed']).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  duration_hours: z.number().min(0).max(48).nullable().optional(),
  cost_note: z.string().trim().max(120).nullable().optional(),
  kind: z.enum(['activity', 'meal', 'travel', 'stay', 'rest']).optional(),
});

export async function PATCH(
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

    const patch = parsed.data;
    if (Object.keys(patch).length === 0) return fail('Nothing to update');

    // Editing invalidates the cached deep-dive detail, since it was researched
    // for the old title. Clear it so it re-fetches against the new one.
    const clearsDetail = patch.title !== undefined;

    const { data, error } = await db()
      .from('plan_stops')
      .update({
        ...patch,
        ...(clearsDetail
          ? { detail: null, detail_sources: [], detail_grounded: false, detail_fetched_at: null }
          : {}),
      })
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .select()
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return fail('That stop is not on this trip', 404);

    return ok({ stop: data as PlanStop });
  });
}
