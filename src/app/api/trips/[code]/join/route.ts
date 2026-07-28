import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, loadMembers, loadTrip, ok } from '@/lib/api';
import { generateMemberSecret, hashSecret } from '@/lib/codes';
import { getCurrentMember, setMemberCookie } from '@/lib/session';

const Body = z.object({
  display_name: z.string().trim().min(1).max(40),
  avatar_emoji: z.string().trim().min(1).max(8).default('🙂'),
  color: z.string().trim().max(20).default('amber'),
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    // Already joined on this device? Return the existing identity rather than
    // creating a duplicate member every time the link is opened.
    const existing = await getCurrentMember(trip.id);
    if (existing) return ok({ trip, member: existing });

    if (trip.locked) return fail('This trip has been locked and is not taking new members', 403);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const b = parsed.data;

    const members = await loadMembers(trip.id);
    if (members.length >= 50) return fail('This trip is full', 403);

    const taken = members.some(
      (m) => m.display_name.toLowerCase() === b.display_name.toLowerCase(),
    );
    if (taken) return fail('Someone in this trip already uses that name, pick another');

    const secret = generateMemberSecret();
    const { data: member, error } = await db()
      .from('members')
      .insert({
        trip_id: trip.id,
        display_name: b.display_name,
        avatar_emoji: b.avatar_emoji,
        color: b.color,
        role: 'member',
        secret_hash: hashSecret(secret),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await setMemberCookie(trip.id, secret);
    return ok({ trip, member }, { status: 201 });
  });
}
