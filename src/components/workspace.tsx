'use client';

import { useState } from 'react';
import type { GroupDna } from '@/lib/dna';
import type { Member, Plan, PlanVoteView, Preferences, ScoredIdea, Trip } from '@/lib/types';
import { tripLengthDays } from '@/lib/utils';
import { DnaPanel } from './dna-panel';
import { IdeasBoard } from './ideas-board';
import { PlansPanel } from './plans-panel';
import { Concierge, type ChatMessage } from './concierge';
import { InviteBar } from './invite-bar';

type Tab = 'plans' | 'crew' | 'ideas' | 'ask';

const TABS: { id: Tab; label: string }[] = [
  { id: 'plans', label: 'Plans' },
  { id: 'crew', label: 'Your group' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'ask', label: 'Ask' },
];

export function Workspace({
  trip,
  me,
  members,
  dna,
  ideas,
  myPrefs,
  messages,
  inviteUrl,
  plans,
  planVote,
}: {
  trip: Trip;
  me: Member;
  members: Member[];
  dna: GroupDna;
  ideas: ScoredIdea[];
  myPrefs: Preferences | null;
  messages: ChatMessage[];
  inviteUrl: string;
  plans: Plan[];
  planVote: PlanVoteView;
}) {
  // Land on Plans until this member has ranked them: reacting to three concrete
  // trips is a far better first move than facing an empty preferences form.
  const [tab, setTab] = useState<Tab>(
    planVote.myRanking.length === 0 ? 'plans' : myPrefs ? 'ideas' : 'crew',
  );
  const days = tripLengthDays(trip.start_date, trip.end_date);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-28 pt-8 sm:px-5">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-ink-500">
              <span>🧭</span>
              <span className="font-display tracking-wide">Wayfare</span>
            </div>
            <h1 className="truncate font-display text-2xl sm:text-3xl">{trip.name}</h1>
            <p className="mt-1 text-sm text-ink-400">
              {trip.destination}
              {days ? ` · ${days} days` : ''}
              {trip.start_date ? ` · from ${trip.start_date}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 -space-x-1.5">
            {members.slice(0, 6).map((m) => (
              <span
                key={m.id}
                title={m.display_name}
                className="flex size-8 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-sm"
              >
                {m.avatar_emoji}
              </span>
            ))}
            {members.length > 6 && (
              <span className="flex size-8 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-xs text-ink-400">
                +{members.length - 6}
              </span>
            )}
          </div>
        </div>

        <InviteBar joinCode={trip.join_code} inviteUrl={inviteUrl} />
      </header>

      <nav className="mt-7 flex gap-1 border-b border-ink-800" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              '-mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors ' +
              (tab === t.id
                ? 'border-glow text-ink-100'
                : 'border-transparent text-ink-500 hover:text-ink-300')
            }
          >
            {t.label}
            {t.id === 'ideas' && ideas.length > 0 && (
              <span className="ml-1.5 text-xs text-ink-500">{ideas.length}</span>
            )}
            {t.id === 'plans' && planVote.myRanking.length === 0 && plans.length > 0 && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-glow align-middle" />
            )}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'plans' && (
          <PlansPanel
            code={trip.invite_token}
            plans={plans}
            vote={planVote}
            state={trip.plans_state}
            me={me}
            isOwner={me.role === 'owner'}
          />
        )}
        {tab === 'crew' && (
          <DnaPanel
            code={trip.invite_token}
            dna={dna}
            members={members}
            me={me}
            myPrefs={myPrefs}
            onSaved={() => setTab('ideas')}
          />
        )}
        {tab === 'ideas' && (
          <IdeasBoard code={trip.invite_token} ideas={ideas} me={me} members={members} dna={dna} />
        )}
        {tab === 'ask' && <Concierge code={trip.invite_token} initial={messages} members={members} />}
      </div>
    </div>
  );
}
