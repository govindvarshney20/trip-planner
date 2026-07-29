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
import { deriveTripName } from '@/lib/trip-copy';

const Body = z.object({
  destination: z.string().trim().min(2).max(120),
  // Length + month replace exact dates as the required inputs: people know
  // "nine days in October" long before they know "24 Oct to 1 Nov".
  day_count: z.number().int().min(1).max(60),
  travel_month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month')
    .nullable()
    .optional(),
  party_size: z.number().int().min(1).max(50),
  // The creator becomes the first member in the same round-trip.
  display_name: z.string().trim().min(1).max(40),

  // Everything below is optional -- it lives behind the advanced toggle.
  name: z.string().trim().min(1).max(80).nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  budget_level: z.enum(['shoestring', 'value', 'comfort', 'luxury']).nullable().optional(),
  currency: z.string().trim().length(3).default('INR'),
  brief: z.string().trim().max(2000).nullable().optional(),
  avatar_emoji: z.string().trim().min(1).max(8).default('🧭'),
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
          // Trip name is optional in the form; derive a readable one.
          name: b.name?.trim() || deriveTripName(b.destination, b.day_count),
          destination: b.destination,
          day_count: b.day_count,
          travel_month: b.travel_month ?? null,
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
