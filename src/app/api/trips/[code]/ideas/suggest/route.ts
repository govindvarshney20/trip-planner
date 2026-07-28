import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { suggestIdeas } from '@/lib/suggest';
import type { Idea } from '@/lib/types';

export const maxDuration = 60;

const Body = z.object({
  count: z.number().int().min(1).max(12).default(8),
  focus: z.string().trim().max(200).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);

    const body = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');

    const [dna, existing] = await Promise.all([
      loadDna(trip.id),
      db().from('ideas').select('title').eq('trip_id', trip.id),
    ]);

    const exclude = (existing.data ?? []).map((r) => (r as { title: string }).title);

    const result = await suggestIdeas(trip, dna, {
      count: parsed.data.count,
      focus: parsed.data.focus,
      exclude,
    });

    const seen = new Set(exclude.map((t) => t.toLowerCase()));
    const rows = result.data.ideas
      .filter((i) => {
        const key = i.title?.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((i) => ({
        trip_id: trip.id,
        title: i.title.trim(),
        category: i.category ?? 'sight',
        locality: i.locality ?? null,
        description: i.description ?? null,
        why_fits: i.why_fits ?? null,
        // Clamp rather than trust: a malformed rating should not fail the insert.
        rating: typeof i.rating === 'number' ? Math.min(5, Math.max(0, i.rating)) : null,
        rating_count: typeof i.rating_count === 'number' ? Math.round(i.rating_count) : null,
        price_note: i.price_note ?? null,
        duration_hours: typeof i.duration_hours === 'number' ? i.duration_hours : null,
        best_time: i.best_time ?? null,
        booking_url: i.booking_url?.startsWith('http') ? i.booking_url : null,
        source: 'ai' as const,
        sources: result.sources,
        grounded: result.grounded,
        added_by: member.id,
      }));

    if (rows.length === 0) {
      return ok({ ideas: [] as Idea[], grounded: result.grounded, added: 0 });
    }

    const { data, error } = await db().from('ideas').insert(rows).select();
    if (error) throw new Error(error.message);

    return ok({
      ideas: (data ?? []) as Idea[],
      grounded: result.grounded,
      added: data?.length ?? 0,
    });
  });
}
