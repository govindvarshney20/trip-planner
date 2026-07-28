import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';

const Body = z.object({
  idea_id: z.string().uuid(),
  // null clears an existing reaction, so a misclick is undoable.
  value: z.enum(['must', 'keen', 'meh', 'no']).nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const { idea_id, value } = parsed.data;

    // Confirm the idea belongs to this trip before touching it, so a member of
    // one trip cannot vote on another trip's board by guessing an id.
    const { data: idea } = await db()
      .from('ideas')
      .select('id')
      .eq('id', idea_id)
      .eq('trip_id', trip.id)
      .maybeSingle();
    if (!idea) return fail('That idea is not on this trip', 404);

    if (value === null) {
      const { error } = await db()
        .from('reactions')
        .delete()
        .eq('idea_id', idea_id)
        .eq('member_id', member.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db()
        .from('reactions')
        .upsert({ idea_id, member_id: member.id, value }, { onConflict: 'idea_id,member_id' });
      if (error) throw new Error(error.message);
    }

    const { data: reactions } = await db()
      .from('reactions')
      .select('*')
      .eq('idea_id', idea_id);

    return ok({ reactions: reactions ?? [] });
  });
}
