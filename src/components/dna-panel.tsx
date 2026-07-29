'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { consensusLabel, type GroupDna } from '@/lib/dna';
import type { Member, Preferences } from '@/lib/types';
import { DIETARY, INTERESTS } from '@/lib/types';
import { Button, Chip, Field, Select, Spinner, Textarea } from './ui';

const PACES = [
  { v: 'chill', label: 'Chill', hint: 'One or two things a day' },
  { v: 'balanced', label: 'Balanced', hint: 'Full but not rushed' },
  { v: 'packed', label: 'Packed', hint: 'Fit everything in' },
] as const;

const WAKES = [
  { v: 'early', label: 'Early', hint: 'Up at 6' },
  { v: 'mid', label: 'Mid', hint: 'Out by 9' },
  { v: 'late', label: 'Late', hint: 'Slow mornings' },
] as const;

const INTENSITIES = [
  { v: 'low', label: 'Easy', hint: 'Short walks' },
  { v: 'moderate', label: 'Moderate', hint: 'Long days on foot' },
  { v: 'high', label: 'Hard', hint: 'Treks and bikes' },
] as const;

function SegmentedGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { v: T; label: string; hint: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-ink-300">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            className={
              'rounded-lg border px-2.5 py-2.5 text-left transition-colors ' +
              (value === o.v
                ? 'border-glow bg-[rgba(240,180,41,0.10)]'
                : 'border-ink-700 hover:border-ink-500')
            }
          >
            <span className="block text-sm">{o.label}</span>
            <span className="mt-0.5 block text-[11px] leading-tight text-ink-500">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DnaPanel({
  code,
  dna,
  members,
  me,
  myPrefs,
  onSaved,
}: {
  code: string;
  dna: GroupDna;
  members: Member[];
  me: Member;
  myPrefs: Preferences | null;
  /** Optional: the Preferences tab has nowhere to send the user afterwards. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!myPrefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pace, setPace] = useState(myPrefs?.pace ?? null);
  const [wake, setWake] = useState(myPrefs?.wake_time ?? null);
  const [intensity, setIntensity] = useState(myPrefs?.intensity ?? null);
  const [budget, setBudget] = useState(myPrefs?.budget_level ?? 'value');
  const [interests, setInterests] = useState<string[]>(myPrefs?.interests ?? []);
  const [dietary, setDietary] = useState<string[]>(myPrefs?.dietary ?? []);
  const [nonNeg, setNonNeg] = useState(myPrefs?.non_negotiables ?? '');

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(code)}/prefs`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pace,
          wake_time: wake,
          intensity,
          budget_level: budget,
          interests,
          dietary,
          non_negotiables: nonNeg.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save');
      setEditing(false);
      router.refresh();
      if (!myPrefs) onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="card space-y-6 p-5">
        <div>
          <h2 className="font-display text-xl">Your preferences</h2>
          <p className="mt-1 text-sm text-ink-400">
            Takes a minute. Everything we suggest is built from these answers, and only your
            group sees them.
          </p>
        </div>

        <SegmentedGroup label="How packed should the days be?" options={PACES} value={pace} onChange={setPace} />
        <SegmentedGroup label="When do you want to start?" options={WAKES} value={wake} onChange={setWake} />
        <SegmentedGroup label="How physical are you up for?" options={INTENSITIES} value={intensity} onChange={setIntensity} />

        <Field label="Your budget comfort">
          <Select value={budget} onChange={(e) => setBudget(e.target.value as typeof budget)}>
            <option value="shoestring">Shoestring — hostels, street food, buses</option>
            <option value="value">Value — clean rooms, occasional splurge</option>
            <option value="comfort">Comfort — good hotels, private transport</option>
            <option value="luxury">Luxury — the best available</option>
          </Select>
        </Field>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink-300">
            What are you here for? <span className="text-ink-500">Pick any.</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {INTERESTS.map((i) => (
              <Chip key={i} active={interests.includes(i)} onClick={() => toggle(interests, setInterests, i)}>
                {i}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink-300">
            Dietary needs <span className="text-ink-500">We treat these as hard rules.</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DIETARY.map((d) => (
              <Chip key={d} active={dietary.includes(d)} onClick={() => toggle(dietary, setDietary, d)}>
                {d}
              </Chip>
            ))}
          </div>
        </div>

        <Field
          label="Anything non-negotiable?"
          hint='The one thing you would be gutted to miss. e.g. "I am doing the Ha Giang loop."'
        >
          <Textarea value={nonNeg} onChange={(e) => setNonNeg(e.target.value)} rows={2} maxLength={500} />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-coral">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {myPrefs && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  const answered = new Set(dna.respondents ? members.map((m) => m.id) : []);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl">Group DNA</h2>
            <p className="mt-1 text-sm text-ink-400">
              {dna.respondents} of {dna.totalMembers} have answered.
            </p>
          </div>
          {/* A consensus score needs at least two opinions to mean anything.
              Below that we'd be telling a group that hasn't answered yet that
              they disagree, or telling one person they agree with themselves. */}
          {dna.respondents >= 2 && (
            <div className="text-right">
              <div className="font-display text-3xl text-glow">{dna.consensus}</div>
              <div className="text-[11px] uppercase tracking-wide text-ink-500">consensus</div>
            </div>
          )}
        </div>

        {dna.respondents >= 2 ? (
          <>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-glow transition-[width] duration-500"
                style={{ width: `${dna.consensus}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-ink-400">{consensusLabel(dna.consensus)}</p>
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-400">
            {dna.respondents === 0
              ? 'Once two of you have filled this in, we’ll show where you agree and where you don’t.'
              : 'One more person and we can show you where the group agrees.'}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {members.map((m) => (
            <span
              key={m.id}
              className="flex items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-1 text-sm"
            >
              <span>{m.avatar_emoji}</span>
              <span className={answered.has(m.id) ? 'text-ink-200' : 'text-ink-500'}>
                {m.display_name}
                {m.id === me.id && ' (you)'}
              </span>
            </span>
          ))}
        </div>

        <Button variant="outline" size="sm" className="mt-5" onClick={() => setEditing(true)}>
          Edit my preferences
        </Button>
      </div>

      {dna.shared.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-medium text-ink-300">What you all want</h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {dna.shared.map((s) => (
              <span
                key={s.interest}
                className="rounded-full border border-jade/40 bg-[rgba(63,185,132,0.10)] px-3 py-1 text-sm text-jade"
              >
                {s.interest}
                <span className="ml-1.5 opacity-60">
                  {s.count}/{dna.respondents}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {dna.split.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-medium text-ink-300">Only some of you</h3>
          <p className="mt-1 text-xs text-ink-500">
            We&rsquo;ll still fit at least one of each in, so nobody goes home disappointed.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {dna.split.map((s) => (
              <span
                key={s.interest}
                className="rounded-full border border-ink-700 px-3 py-1 text-sm text-ink-300"
                title={s.members.join(', ')}
              >
                {s.interest}
                <span className="ml-1.5 text-ink-500">{s.members.join(', ')}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {dna.conflicts.length > 0 && (
        <div className="space-y-3">
          <h3 className="px-1 text-sm font-medium text-ink-300">Worth settling now</h3>
          {dna.conflicts.map((c, i) => (
            <div
              key={i}
              className={
                'card border-l-2 p-4 ' +
                (c.severity === 'clash'
                  ? 'border-l-coral'
                  : c.severity === 'warn'
                    ? 'border-l-glow'
                    : 'border-l-ink-600')
              }
            >
              <h4 className="text-sm font-medium">{c.title}</h4>
              <p className="mt-1 text-sm leading-relaxed text-ink-400">{c.detail}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-300">
                <span className="text-ink-500">Try this — </span>
                {c.suggestion}
              </p>
            </div>
          ))}
        </div>
      )}

      {dna.nonNegotiables.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-medium text-ink-300">Non-negotiables</h3>
          <ul className="mt-3 space-y-2">
            {dna.nonNegotiables.map((n, i) => (
              <li key={i} className="text-sm text-ink-300">
                <span className="text-ink-500">{n.member}:</span> &ldquo;{n.text}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
