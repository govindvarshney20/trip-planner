'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { AVATARS } from '@/components/avatars';

export default function NewTripPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emoji, setEmoji] = useState('🧭');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;

    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: str('name'),
          destination: str('destination'),
          start_date: str('start_date'),
          end_date: str('end_date'),
          party_size: Number(f.get('party_size') || 1),
          budget_level: str('budget_level'),
          currency: str('currency') || 'INR',
          brief: str('brief'),
          display_name: str('display_name'),
          avatar_emoji: emoji,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not create the trip');
      router.push(`/t/${body.trip.invite_token}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-12">
      <Link href="/" className="text-sm text-ink-500 hover:text-ink-300">
        ← Wayfare
      </Link>

      <h1 className="mt-6 font-display text-3xl">Start a trip</h1>
      <p className="mt-2 text-sm text-ink-400">
        You can change all of this later. Only the destination really matters to get going.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div className="card space-y-5 p-5">
          <Field label="Trip name">
            <Input name="name" required maxLength={80} placeholder="North Vietnam" />
          </Field>

          <Field label="Where are you going?" hint="A country, a region, or a list of cities.">
            <Input
              name="destination"
              required
              maxLength={120}
              placeholder="Hanoi, Ha Giang, Ninh Binh, Cat Ba"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <Input name="start_date" type="date" />
            </Field>
            <Field label="End date">
              <Input name="end_date" type="date" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="How many of you?">
              <Input name="party_size" type="number" min={1} max={50} defaultValue={4} required />
            </Field>
            <Field label="Budget level">
              <Select name="budget_level" defaultValue="value">
                <option value="shoestring">Shoestring</option>
                <option value="value">Value</option>
                <option value="comfort">Comfort</option>
                <option value="luxury">Luxury</option>
              </Select>
            </Field>
            <Field label="Currency">
              <Select name="currency" defaultValue="INR">
                <option value="INR">INR ₹</option>
                <option value="USD">USD $</option>
                <option value="EUR">EUR €</option>
                <option value="GBP">GBP £</option>
                <option value="VND">VND ₫</option>
                <option value="SGD">SGD $</option>
                <option value="AED">AED د.إ</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Anything we should know?"
            hint="Optional. First international trip, must do the Ha Giang loop, one person gets carsick — all of it helps."
          >
            <Textarea name="brief" rows={3} maxLength={2000} />
          </Field>
        </div>

        <div className="card space-y-5 p-5">
          <h2 className="font-display text-lg">And you are…</h2>

          <Field label="Your name" hint="What your friends call you. No account needed.">
            <Input name="display_name" required maxLength={40} placeholder="Govind" />
          </Field>

          <div>
            <span className="mb-2 block text-sm font-medium text-ink-300">Pick an avatar</span>
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

        {error && (
          <p role="alert" className="text-sm text-coral">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy && <Spinner />}
          {busy ? 'Creating…' : 'Create trip'}
        </Button>
      </form>
    </main>
  );
}
