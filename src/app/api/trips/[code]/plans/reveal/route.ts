import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';

/**
 * Manual reveal, for when someone is unreachable and the group wants to move
 * on. Restricted to the trip owner: any member being able to flip it early
 * would defeat blind voting entirely.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);
    if (member.role !== 'owner') {
      return fail('Only whoever created the trip can reveal the results early', 403);
    }

    if (trip.plans_revealed_at) return ok({ revealed_at: trip.plans_revealed_at });

    const revealedAt = new Date().toISOString();
    const { error } = await db()
      .from('trips')
      .update({ plans_revealed_at: revealedAt })
      .eq('id', trip.id);
    if (error) throw new Error(error.message);

    return ok({ revealed_at: revealedAt });
  });
}
