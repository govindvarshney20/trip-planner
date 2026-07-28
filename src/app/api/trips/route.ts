import { z } from 'zod';
import { db } from '@/lib/supabase';
import { fail, guard, ok } from '@/lib/api';
import {
  generateInviteToken,
  generateJoinCode,
  generateMemberSecret,
  hashSecret,
} from '@/lib/codes';
import { setMemberCookie } from '@/lib/session';

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  destination: z.string().trim().min(1).max(120),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  party_size: z.number().int().min(1).max(50),
  budget_level: z.enum(['shoestring', 'value', 'comfort', 'luxury']).nullable().optional(),
  currency: z.string().trim().length(3).default('INR'),
  brief: z.string().trim().max(2000).nullable().optional(),
  // The creator becomes the first member in the same round-trip.
  display_name: z.string().trim().min(1).max(40),
  avatar_emoji: z.string().trim().min(1).max(8).default('🙂'),
  color: z.string().trim().max(20).default('amber'),
});

export async function POST(req: Request) {
  return guard(async () => {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid input');
    const b = parsed.data;

    if (b.start_date && b.end_date && b.end_date < b.start_date) {
      return fail('The end date is before the start date');
    }

    // Join codes are short enough that a collision is possible; retry a few times.
    let trip = null;
    for (let attempt = 0; attempt < 5 && !trip; attempt++) {
      const { data, error } = await db()
        .from('trips')
        .insert({
          join_code: generateJoinCode(),
          invite_token: generateInviteToken(),
          name: b.name,
          destination: b.destination,
          start_date: b.start_date ?? null,
          end_date: b.end_date ?? null,
          party_size: b.party_size,
          budget_level: b.budget_level ?? null,
          currency: b.currency.toUpperCase(),
          brief: b.brief ?? null,
        })
        .select()
        .single();

      if (!error) trip = data;
      else if (!error.message.includes('duplicate key')) throw new Error(error.message);
    }
    if (!trip) return fail('Could not allocate a join code, please try again', 503);

    const secret = generateMemberSecret();
    const { error: memberErr } = await db().from('members').insert({
      trip_id: trip.id,
      display_name: b.display_name,
      avatar_emoji: b.avatar_emoji,
      color: b.color,
      role: 'owner',
      secret_hash: hashSecret(secret),
    });
    if (memberErr) throw new Error(memberErr.message);

    await setMemberCookie(trip.id, secret);

    return ok({ trip }, { status: 201 });
  });
}
