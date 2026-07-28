'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, Spinner } from './ui';
import { AVATARS } from './avatars';

/** Shown when someone opens an invite link without a membership cookie. */
export function JoinGate({
  code,
  tripName,
  destination,
  memberCount,
  locked,
}: {
  code: string;
  tripName: string;
  destination: string;
  memberCount: number;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string>(AVATARS[1]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const name = (new FormData(e.currentTarget).get('display_name') as string)?.trim();
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: name, avatar_emoji: emoji }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not join');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <div className="mb-8 flex items-center gap-2">
        <span>🧭</span>
        <span className="font-display tracking-wide">Wayfare</span>
      </div>

      <p className="text-sm text-ink-400">You&rsquo;ve been invited to</p>
      <h1 className="mt-1 font-display text-3xl">{tripName}</h1>
      <p className="mt-1.5 text-ink-300">{destination}</p>
      <p className="mt-3 text-sm text-ink-500">
        {memberCount === 1 ? '1 person is' : `${memberCount} people are`} already planning.
      </p>

      {locked ? (
        <p className="card mt-8 p-4 text-sm text-ink-300">
          This trip has been locked and isn&rsquo;t taking new members. Ask whoever set it up to
          unlock it.
        </p>
      ) : (
        <form onSubmit={submit} className="card mt-8 space-y-5 p-5">
          <Field label="What should we call you?" hint="No account, no password. Just a name.">
            <Input name="display_name" required maxLength={40} autoFocus placeholder="Your name" />
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

          {error && (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner />}
            {busy ? 'Joining…' : 'Join the trip'}
          </Button>
        </form>
      )}
    </main>
  );
}
