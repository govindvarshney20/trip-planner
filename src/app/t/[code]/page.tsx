import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/lib/supabase';
import { loadDna, loadMembers, loadPlans, loadTrip } from '@/lib/api';
import { getCurrentMember } from '@/lib/session';
import { REACTION_WEIGHT, type Idea, type Preferences, type Reaction, type ScoredIdea } from '@/lib/types';
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

  const [dna, planData, ideasRes, reactionsRes, prefsRes, messagesRes] = await Promise.all([
    loadDna(trip.id),
    loadPlans(trip.id, member.id, trip.plans_revealed_at),
    db().from('ideas').select('*').eq('trip_id', trip.id).order('created_at', { ascending: false }),
    db().from('reactions').select('*'),
    db().from('preferences').select('*').eq('member_id', member.id).maybeSingle(),
    db()
      .from('messages')
      .select('*')
      .eq('trip_id', trip.id)
      .order('created_at')
      .limit(50),
  ]);

  const ideas = (ideasRes.data ?? []) as Idea[];
  const ideaIds = new Set(ideas.map((i) => i.id));
  const allReactions = ((reactionsRes.data ?? []) as Reaction[]).filter((r) =>
    ideaIds.has(r.idea_id),
  );

  const scored: ScoredIdea[] = ideas
    .map((idea) => {
      const reactions = allReactions.filter((r) => r.idea_id === idea.id);
      return {
        ...idea,
        reactions,
        score: reactions.reduce((sum, r) => sum + REACTION_WEIGHT[r.value], 0),
        contested: reactions.some((r) => r.value === 'no'),
        votesIn: reactions.length,
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return (
    <Workspace
      trip={trip}
      me={member}
      members={members}
      dna={dna}
      ideas={scored}
      myPrefs={(prefsRes.data as Preferences) ?? null}
      messages={messagesRes.data ?? []}
      inviteUrl={`${await requestOrigin()}/t/${trip.invite_token}`}
      plans={planData.plans}
      planVote={planData.vote}
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
