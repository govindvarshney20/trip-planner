import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/lib/supabase';
import { loadDna, loadItinerary, loadMembers, loadTrip } from '@/lib/api';
import { getCurrentMember } from '@/lib/session';
import type { Preferences } from '@/lib/types';
import { JoinGate } from '@/components/join-gate';
import { Workspace } from '@/components/workspace';

export const dynamic = 'force-dynamic';

export default async function TripPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const trip = await loadTrip(code);
  if (!trip) notFound();

  const member = await getCurrentMember(trip.id);
  const members = await loadMembers(trip.id);

  // Not a member yet: show the join form rather than the trip. Only the trip's
  // name and destination leak, which is what the inviter intended to share.
  if (!member) {
    return (
      <JoinGate
        code={code}
        tripName={trip.name}
        destination={trip.destination}
        memberCount={members.length}
        locked={trip.locked}
      />
    );
  }

  const [dna, days, prefsRes, messagesRes] = await Promise.all([
    loadDna(trip.id),
    loadItinerary(trip.id, member.id),
    db().from('preferences').select('*').eq('member_id', member.id).maybeSingle(),
    db().from('messages').select('*').eq('trip_id', trip.id).order('created_at').limit(50),
  ]);

  return (
    <Workspace
      trip={trip}
      me={member}
      members={members}
      dna={dna}
      myPrefs={(prefsRes.data as Preferences) ?? null}
      messages={messagesRes.data ?? []}
      inviteUrl={`${await requestOrigin()}/t/${trip.invite_token}`}
      days={days}
    />
  );
}

/**
 * Origin of the current request, so invite links work on localhost, on a
 * Vercel preview URL and on a custom domain without any of them being
 * hardcoded.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
