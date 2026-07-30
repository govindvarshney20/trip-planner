import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';

const Body = z.object({
  // Stop ids in their new order, top to bottom.
  stopIds: z.array(z.string().uuid()).min(1).max(40),
});

/** Rewrite the ordering of a day's stops. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; dayIndex: string }> },
) {
  return guard(async () => {
    const { code, dayIndex } = await ctx.params;
    const day_index = Number(dayIndex);
    if (!Number.isInteger(day_index) || day_index < 0) return fail('Bad day', 400);

    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const { stopIds } = parsed.data;

    // Only reorder stops that genuinely belong to this day, so a stray id can't
    // pull another day's stop into this one.
    const { data: owned, error: ownErr } = await db()
      .from('plan_stops')
      .select('id')
      .eq('trip_id', trip.id)
      .eq('day_index', day_index)
      .neq('status', 'removed');
    if (ownErr) throw new Error(ownErr.message);

    const ownedIds = new Set((owned ?? []).map((s) => (s as { id: string }).id));
    const order = stopIds.filter((id) => ownedIds.has(id));
    if (order.length === 0) return fail('None of those stops are on this day', 400);

    // Spaced by 100 so a later single-stop move can slot between two.
    for (let i = 0; i < order.length; i++) {
      const { error } = await db()
        .from('plan_stops')
        .update({ position: (i + 1) * 100 })
        .eq('id', order[i])
        .eq('trip_id', trip.id);
      if (error) throw new Error(error.message);
    }

    return ok({ ordered: order.length });
  });
}
