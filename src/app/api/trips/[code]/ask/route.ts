import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadItinerary, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { askConcierge } from '@/lib/concierge';

export const maxDuration = 60;

const Body = z.object({
  question: z.string().trim().min(2).max(1000),
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const { question } = parsed.data;

    const [dna, days, history] = await Promise.all([
      loadDna(trip.id),
      loadItinerary(trip.id, member.id),
      db()
        .from('messages')
        .select('role, content')
        .eq('trip_id', trip.id)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

    const priorTurns = ((history.data ?? []) as { role: 'user' | 'assistant'; content: string }[])
      .slice()
      .reverse();

    await db().from('messages').insert({
      trip_id: trip.id,
      member_id: member.id,
      role: 'user',
      content: question,
    });

    const answer = await askConcierge(trip, dna, question, days, priorTurns);

    const { data: saved, error } = await db()
      .from('messages')
      .insert({
        trip_id: trip.id,
        member_id: null,
        role: 'assistant',
        content: answer.text,
        sources: answer.sources,
        grounded: answer.grounded,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return ok({ message: saved });
  });
}
