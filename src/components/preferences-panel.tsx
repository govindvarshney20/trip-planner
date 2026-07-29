'use client';

import type { GroupDna } from '@/lib/dna';
import type { Member, Preferences, Trip } from '@/lib/types';
import { formatMonth, tripDays } from '@/lib/trip-copy';
import { DnaPanel } from './dna-panel';

/**
 * Preferences = what we already know about the trip, plus what this member can
 * tell us to sharpen the plan, plus the group's combined picture.
 *
 * Group DNA lives here rather than on its own tab: the conflict-surfacing is
 * genuinely useful but didn't justify a tab of its own on a phone.
 */
export function PreferencesPanel({
  code,
  dna,
  members,
  me,
  myPrefs,
  trip,
}: {
  code: string;
  dna: GroupDna;
  members: Member[];
  me: Member;
  myPrefs: Preferences | null;
  trip: Trip;
}) {
  const days = tripDays(trip);

  const setup: [string, string | null][] = [
    ['Destination', trip.destination],
    ['Length', days ? `${days} ${days === 1 ? 'day' : 'days'}` : null],
    [
      'When',
      trip.start_date && trip.end_date
        ? `${trip.start_date} → ${trip.end_date}`
        : formatMonth(trip.travel_month),
    ],
    ['Travellers', String(trip.party_size)],
    ['Budget', trip.budget_level],
    ['Currency', trip.currency],
  ];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-display text-xl">The trip</h2>
        <p className="mt-1 text-sm text-ink-400">What we&rsquo;re planning around.</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {setup.map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
                <dd className="mt-0.5 text-sm capitalize text-ink-200">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>

        {trip.brief && (
          <div className="mt-4 border-t border-ink-800 pt-4">
            <dt className="text-xs uppercase tracking-wide text-ink-500">
              What you told us at the start
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-300">{trip.brief}</dd>
          </div>
        )}
      </div>

      <DnaPanel code={code} dna={dna} members={members} me={me} myPrefs={myPrefs} />
    </div>
  );
}
