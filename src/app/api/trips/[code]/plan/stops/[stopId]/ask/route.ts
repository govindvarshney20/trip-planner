import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { askAboutStop } from '@/lib/concierge';
import type { PlanStop } from '@/lib/types';

export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(2).max(500) });

/** Ask a focused question about one place. Ephemeral -- the answer isn't stored. */
export async function POST(
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

    const { data: stop } = await db()
      .from('plan_stops')
      .select('title, locality, kind')
      .eq('id', stopId)
      .eq('trip_id', trip.id)
      .maybeSingle();
    if (!stop) return fail('That stop is not on this trip', 404);
    const s = stop as Pick<PlanStop, 'title' | 'locality' | 'kind'>;

    const answer = await askAboutStop(
      trip,
      { title: s.title, locality: s.locality, kind: s.kind },
      parsed.data.question,
    );

    return ok(answer);
  });
}
