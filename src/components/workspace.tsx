'use client';

import { useState } from 'react';
import type { GroupDna } from '@/lib/dna';
import type { ItineraryDay, Member, PlansState, Preferences, Trip } from '@/lib/types';
import { tripDays, tripWhen } from '@/lib/trip-copy';
import { PlanPanel } from './plan-panel';
import { PreferencesPanel } from './preferences-panel';
import { Concierge, type ChatMessage } from './concierge';
import { InviteBar } from './invite-bar';

type Tab = 'plan' | 'prefs' | 'ask';

const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'prefs', label: 'Preferences' },
  { id: 'ask', label: 'Ask' },
];

export function Workspace({
  trip,
  me,
  members,
  dna,
  myPrefs,
  messages,
  inviteUrl,
  days,
}: {
  trip: Trip;
  me: Member;
  members: Member[];
  dna: GroupDna;
  myPrefs: Preferences | null;
  messages: ChatMessage[];
  inviteUrl: string;
  days: ItineraryDay[];
}) {
  const [tab, setTab] = useState<Tab>('plan');
  const when = tripWhen(trip);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-8 sm:px-5">
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
              {when ? ` · ${when}` : ''}
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
            {/* Nudge toward Preferences once a plan exists but this member
                hasn't told us anything -- that's when it pays off most. */}
            {t.id === 'prefs' && !myPrefs && days.length > 0 && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-glow align-middle" />
            )}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'plan' && (
          <PlanPanel
            code={trip.invite_token}
            days={days}
            state={trip.plans_state as PlansState}
            dayCount={tripDays(trip)}
          />
        )}
        {tab === 'prefs' && (
          <PreferencesPanel
            code={trip.invite_token}
            dna={dna}
            members={members}
            me={me}
            myPrefs={myPrefs}
            trip={trip}
          />
        )}
        {tab === 'ask' && (
          <Concierge code={trip.invite_token} initial={messages} members={members} />
        )}
      </div>
    </div>
  );
}
