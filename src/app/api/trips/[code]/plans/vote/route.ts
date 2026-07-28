import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadMembers, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';

const Body = z.object({
  /** Plan ids in the member's preferred order, best first. */
  ranking: z.array(z.string().uuid()).min(1).max(5),
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const { ranking } = parsed.data;

    if (new Set(ranking).size !== ranking.length) {
      return fail('A plan can only appear once in your ranking');
    }

    // Every id must belong to this trip, and the ranking must cover all of its
    // plans -- a partial ranking would silently skew the Borda count.
    const { data: planRows, error: planErr } = await db()
      .from('plans')
      .select('id')
      .eq('trip_id', trip.id);
    if (planErr) throw new Error(planErr.message);

    const validIds = new Set((planRows ?? []).map((p) => (p as { id: string }).id));
    if (ranking.some((id) => !validIds.has(id))) {
      return fail('That plan is not part of this trip', 404);
    }
    if (ranking.length !== validIds.size) {
      return fail(`Please rank all ${validIds.size} plans`);
    }

    // Replace wholesale: ranks carry a uniqueness constraint per member, so
    // updating in place would collide mid-write.
    const { error: delErr } = await db()
      .from('plan_votes')
      .delete()
      .eq('trip_id', trip.id)
      .eq('member_id', member.id);
    if (delErr) throw new Error(delErr.message);

    const { error: insErr } = await db().from('plan_votes').insert(
      ranking.map((planId, i) => ({
        plan_id: planId,
        member_id: member.id,
        trip_id: trip.id,
        rank: i + 1,
      })),
    );
    if (insErr) throw new Error(insErr.message);

    // Auto-reveal once everybody has voted. Waiting on a human to press a
    // button is how a finished vote sits unread for three days.
    const [members, votes] = await Promise.all([
      loadMembers(trip.id),
      db().from('plan_votes').select('member_id').eq('trip_id', trip.id).eq('rank', 1),
    ]);

    const voted = new Set((votes.data ?? []).map((v) => (v as { member_id: string }).member_id));
    const everyoneVoted = members.length > 0 && members.every((m) => voted.has(m.id));

    if (everyoneVoted && !trip.plans_revealed_at) {
      await db()
        .from('trips')
        .update({ plans_revealed_at: new Date().toISOString() })
        .eq('id', trip.id);
    }

    return ok({
      voted: voted.size,
      total: members.length,
      revealed: everyoneVoted || !!trip.plans_revealed_at,
    });
  });
}
