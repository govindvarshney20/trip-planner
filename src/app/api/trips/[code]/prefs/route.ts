import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadDna, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { DIETARY, INTERESTS } from '@/lib/types';

const Body = z.object({
  pace: z.enum(['chill', 'balanced', 'packed']).nullable().optional(),
  budget_level: z.enum(['shoestring', 'value', 'comfort', 'luxury']).nullable().optional(),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  wake_time: z.enum(['early', 'mid', 'late']).nullable().optional(),
  dietary: z.array(z.enum(DIETARY)).max(DIETARY.length).default([]),
  intensity: z.enum(['low', 'moderate', 'high']).nullable().optional(),
  non_negotiables: z.string().trim().max(500).nullable().optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    const member = await requireMember(trip.id);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const b = parsed.data;

    const { error } = await db()
      .from('preferences')
      .upsert(
        {
          member_id: member.id,
          trip_id: trip.id,
          pace: b.pace ?? null,
          budget_level: b.budget_level ?? null,
          interests: b.interests,
          wake_time: b.wake_time ?? null,
          dietary: b.dietary,
          intensity: b.intensity ?? null,
          non_negotiables: b.non_negotiables ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'member_id' },
      );
    if (error) throw new Error(error.message);

    // Return the recomputed DNA so the client can update without a refetch.
    return ok({ dna: await loadDna(trip.id) });
  });
}
