'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CONTEXT_CHIPS, guessCurrency, monthOptions } from '@/lib/trip-copy';
import { AVATARS } from './avatars';
import { Chip, Input, Select, Spinner, Textarea } from './ui';

/**
 * The whole create flow, inline on the landing page.
 *
 * Five required fields, everything else behind a toggle. A separate /new page
 * put a click between wanting a trip and starting one; this removes it.
 */
export function CreateForm({ monthsFrom }: { monthsFrom: string }) {
  const router = useRouter();
  const months = useMemo(() => monthOptions(new Date(monthsFrom)), [monthsFrom]);

  const [destination, setDestination] = useState('');
  const [days, setDays] = useState('7');
  const [name, setName] = useState('');
  const [month, setMonth] = useState(months[0]?.value ?? '');
  const [party, setParty] = useState('4');

  const [advanced, setAdvanced] = useState(false);
  const [tripName, setTripName] = useState('');
  const [budget, setBudget] = useState('value');
  const [currency, setCurrency] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [emoji, setEmoji] = useState<string>(AVATARS[0]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shown as a placeholder so the user can see the inferred value and override
  // it, rather than us silently deciding.
  const inferredCurrency = destination.trim() ? guessCurrency(destination) : 'INR';

  const ready = destination.trim().length > 1 && name.trim().length > 0 && Number(days) >= 1;

  function toggleChip(id: string) {
    setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    // Chip selections and free text merge into one brief for the model.
    const chipText = CONTEXT_CHIPS.filter((c) => chips.includes(c.id)).map((c) => c.text);
    const brief = [...chipText, notes.trim()].filter(Boolean).join(' ');

    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destination: destination.trim(),
          day_count: Number(days),
          travel_month: month,
          party_size: Number(party),
          display_name: name.trim(),
          name: tripName.trim() || null,
          budget_level: budget,
          currency: currency || inferredCurrency,
          brief: brief || null,
          avatar_emoji: emoji,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not start your trip');
      router.push(`/t/${body.trip.invite_token}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-4 sm:p-6">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-300">Where to?</span>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="North Vietnam, or Hanoi and Ha Giang"
            autoComplete="off"
            className="text-base"
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-300">How many days?</span>
            <Input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              type="number"
              min={1}
              max={60}
              inputMode="numeric"
              className="text-base"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-300">When?</span>
            <Select value={month} onChange={(e) => setMonth(e.target.value)} className="text-base">
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-300">How many of you?</span>
            <Input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              className="text-base"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-300">Your name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Govind"
              autoComplete="given-name"
              className="text-base"
              required
            />
          </label>
        </div>
      </div>

      {/* ---- advanced ---------------------------------------------------- */}
      <button
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        aria-expanded={advanced}
        className="mt-4 flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm text-ink-400 transition-colors hover:text-ink-200"
      >
        <span>Add more detail — optional, but the plan gets better</span>
        <span aria-hidden className={advanced ? 'rotate-180 transition-transform' : 'transition-transform'}>
          ⌄
        </span>
      </button>

      {advanced && (
        <div className="mt-2 space-y-5 border-t border-ink-800 pt-5">
          <div>
            <span className="mb-2 block text-sm font-medium text-ink-300">
              Anything we should know?
            </span>
            <div className="flex flex-wrap gap-1.5">
              {CONTEXT_CHIPS.map((c) => (
                <Chip key={c.id} active={chips.includes(c.id)} onClick={() => toggleChip(c.id)}>
                  {c.label}
                </Chip>
              ))}
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Anything else in your own words — one of us gets carsick, we want to see the rice terraces…"
              className="mt-2.5"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink-300">Budget level</span>
              <Select value={budget} onChange={(e) => setBudget(e.target.value)}>
                <option value="shoestring">Shoestring — hostels, street food, buses</option>
                <option value="value">Value — clean rooms, the odd splurge</option>
                <option value="comfort">Comfort — good hotels, private transport</option>
                <option value="luxury">Luxury — the best available</option>
              </Select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink-300">Currency</span>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder={`${inferredCurrency} — from your destination`}
                maxLength={3}
                spellCheck={false}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-300">Trip name</span>
            <Input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="We'll name it from your destination"
              maxLength={80}
            />
          </label>

          <div>
            <span className="mb-2 block text-sm font-medium text-ink-300">Your avatar</span>
            <div className="flex flex-wrap gap-1.5">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setEmoji(a)}
                  aria-label={`Avatar ${a}`}
                  aria-pressed={emoji === a}
                  className={
                    'flex size-10 items-center justify-center rounded-lg border text-lg transition-colors ' +
                    (emoji === a
                      ? 'border-glow bg-[rgba(240,180,41,0.14)]'
                      : 'border-ink-700 hover:border-ink-500')
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-coral">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready || busy}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-glow px-5 py-3.5 text-base font-semibold text-ink-950 transition-colors hover:bg-[#ffc53d] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy && <Spinner />}
        {busy ? 'Building your plan…' : 'Build my plan'}
      </button>

      <p className="mt-3 text-center text-xs text-ink-500">
        Free. No signup — for you or your friends.
      </p>
    </form>
  );
}
