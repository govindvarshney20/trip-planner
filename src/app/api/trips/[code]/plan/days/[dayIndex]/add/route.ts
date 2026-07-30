import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import type { PlanStop } from '@/lib/types';

const Body = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(['activity', 'meal', 'travel', 'stay', 'rest']).default('activity'),
  summary: z.string().trim().max(2000).optional(),
  duration_hours: z.number().min(0).max(48).optional(),
  cost_note: z.string().trim().max(120).optional(),
});

/** Add a member's own stop to the end of a day. Detail fetches on first open. */
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

    // The day must exist, so a stop can't be orphaned on a day with no frame.
    const { data: day } = await db()
      .from('trip_days')
      .select('day_index, locality')
      .eq('trip_id', trip.id)
      .eq('day_index', day_index)
      .maybeSingle();
    if (!day) return fail('That day is not part of this trip', 404);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const b = parsed.data;

    // Place it after the current last stop.
    const { data: last } = await db()
      .from('plan_stops')
      .select('position')
      .eq('trip_id', trip.id)
      .eq('day_index', day_index)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = ((last as { position: number } | null)?.position ?? 0) + 100;

    const { data, error } = await db()
      .from('plan_stops')
      .insert({
        trip_id: trip.id,
        day_index,
        position,
        title: b.title,
        kind: b.kind,
        locality: (day as { locality: string | null }).locality ?? null,
        summary: b.summary ?? null,
        why_included: 'Added by the group.',
        duration_hours: b.duration_hours ?? null,
        cost_note: b.cost_note ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return ok({ stop: data as PlanStop }, { status: 201 });
  });
}
