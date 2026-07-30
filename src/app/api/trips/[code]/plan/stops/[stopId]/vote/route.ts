import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';

const Body = z.object({
  // null clears the vote, so a misclick is undoable.
  value: z.enum(['keep', 'drop']).nullable(),
});

/** 👍 keep / 👎 drop on a single stop. One vote per member per stop. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; stopId: string }> },
) {
  return guard(async () => {
    const { code, stopId } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const { value } = parsed.data;

    // Confirm the stop is on this trip before touching it.
    const { data: stop } = await db()
      .from('plan_stops')
      .select('id')
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .maybeSingle();
    if (!stop) return fail('That stop is not on this trip', 404);

    if (value === null) {
      const { error } = await db()
        .from('stop_votes')
        .delete()
        .eq('stop_id', stopId)
        .eq('member_id', member.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db()
        .from('stop_votes')
        .upsert(
          { stop_id: stopId, member_id: member.id, trip_id: trip.id, value },
          { onConflict: 'stop_id,member_id' },
        );
      if (error) throw new Error(error.message);
    }

    const { data: votes } = await db()
      .from('stop_votes')
      .select('stop_id, member_id, value')
      .eq('stop_id', stopId);

    return ok({ votes: votes ?? [] });
  });
}
