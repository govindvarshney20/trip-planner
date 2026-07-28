'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderForMember } from '@/lib/plans';
import type { Member, Plan, PlanVoteView, PlansState } from '@/lib/types';
import { Badge, Button, Spinner } from './ui';

const INTENSITY_LABEL: Record<string, string> = {
  low: 'Easy going',
  moderate: 'Moderate',
  high: 'Demanding',
};

export function PlansPanel({
  code,
  plans,
  vote,
  state,
  me,
  isOwner,
}: {
  code: string;
  plans: Plan[];
  vote: PlanVoteView;
  state: PlansState;
  me: Member;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [ranking, setRanking] = useState<string[]>(vote.myRanking);
  const kickedOff = useRef(false);

  // Each member sees a different order, so "first on the page" doesn't quietly
  // become "most voted for".
  const ordered = orderForMember(plans, me.id);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(code)}/plans/generate`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not build the plans');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Kick generation off on first view rather than making someone press a
  // button to see anything. The server holds the real lock, so a race between
  // members is harmless; the ref just avoids firing twice from one mount.
  //
  // This deliberately doesn't reuse generate(): that sets state synchronously,
  // which inside an effect body causes cascading renders.
  useEffect(() => {
    if (kickedOff.current) return;
    if (state !== 'none' || plans.length > 0) return;
    kickedOff.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/trips/${encodeURIComponent(code)}/plans/generate`, {
          method: 'POST',
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Could not build the plans');
        if (!cancelled) router.refresh();
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state, plans.length, code, router]);

  // Someone else may have started generation before we arrived. Poll until it
  // lands, otherwise this member stares at a spinner that never resolves.
  useEffect(() => {
    if (state !== 'generating' || plans.length > 0) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [state, plans.length, router]);

  function toggleRank(planId: string) {
    setRanking((r) =>
      r.includes(planId) ? r.filter((x) => x !== planId) : [...r, planId],
    );
  }

  async function submitVote() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(code)}/plans/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ranking }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save your vote');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    setBusy(true);
    try {
      await fetch(`/api/trips/${encodeURIComponent(code)}/plans/reveal`, { method: 'POST' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /* ---- generating / empty states --------------------------------------- */

  if (plans.length === 0) {
    const failed = state === 'failed';
    return (
      <div className="card p-10 text-center">
        {!failed && <Spinner className="mb-4 text-glow" />}
        <h2 className="font-display text-xl">
          {failed ? 'That didn’t work' : 'Designing three trips for you'}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          {failed
            ? 'Something went wrong building your plans. Trying again usually sorts it.'
            : 'We’re researching your destination and drafting three genuinely different versions of this trip. Takes about half a minute.'}
        </p>
        {(failed || state === 'none') && (
          <Button onClick={generate} disabled={busy} className="mt-5">
            {busy && <Spinner />}
            {busy ? 'Working…' : 'Try again'}
          </Button>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-coral">
            {error}
          </p>
        )}
        {!failed && (
          <button
            onClick={() => router.refresh()}
            className="mt-5 block w-full text-xs text-ink-500 hover:text-ink-300"
          >
            Refresh
          </button>
        )}
      </div>
    );
  }

  /* ---- results ---------------------------------------------------------- */

  const resultFor = (planId: string) => vote.results?.find((r) => r.planId === planId);
  const winner = vote.results?.[0];
  const hasVoted = vote.myRanking.length > 0;
  const rankingComplete = ranking.length === plans.length;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Three ways to do this trip</h2>
            <p className="mt-1 max-w-lg text-sm leading-relaxed text-ink-400">
              Built from the trip brief before anyone shared their preferences, so no
              one&rsquo;s taste shaped the options. Rank them best to worst.
            </p>
          </div>
          {plans[0]?.grounded === false && <Badge tone="warn">unverified</Badge>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-400">
            {vote.votedCount} of {vote.totalMembers} voted
          </span>
          {!vote.revealed && (
            <span className="rounded-full bg-ink-800 px-2.5 py-1 text-xs text-ink-400">
              🙈 Results hidden until everyone votes
            </span>
          )}
          {!vote.revealed && isOwner && vote.votedCount > 0 && (
            <Button size="sm" variant="ghost" onClick={reveal} disabled={busy}>
              Reveal now
            </Button>
          )}
        </div>
      </div>

      {vote.revealed && winner && (
        <div className="card border-l-2 border-l-jade p-5">
          <p className="text-xs uppercase tracking-wide text-ink-500">The group picked</p>
          <h3 className="mt-1 font-display text-2xl">
            {plans.find((p) => p.id === winner.planId)?.label}
          </h3>
          <p className="mt-1.5 text-sm text-ink-400">
            {winner.firsts} first {winner.firsts === 1 ? 'choice' : 'choices'}, {winner.points}{' '}
            points
            {winner.noVetoes ? ', and nobody ranked it last.' : '.'}
          </p>
        </div>
      )}

      {ordered.map((plan) => {
        const rank = ranking.indexOf(plan.id);
        const result = resultFor(plan.id);
        const isWinner = vote.revealed && winner?.planId === plan.id;

        return (
          <article
            key={plan.id}
            className={
              'card p-5 ' + (isWinner ? 'border-jade/50' : '')
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-xl leading-snug">{plan.label}</h3>
                <p className="mt-1 text-sm text-ink-300">{plan.tagline}</p>
              </div>

              <button
                onClick={() => toggleRank(plan.id)}
                aria-label={rank >= 0 ? `Ranked ${rank + 1}` : `Rank ${plan.label}`}
                className={
                  'flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors ' +
                  (rank >= 0
                    ? 'border-glow bg-[rgba(240,180,41,0.16)] text-glow'
                    : 'border-ink-700 text-ink-500 hover:border-ink-500')
                }
              >
                {rank >= 0 ? `#${rank + 1}` : '–'}
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-ink-400">
              <span className="text-ink-500">Gives up — </span>
              {plan.tradeoff}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {plan.intensity && (
                <span className="rounded-md bg-ink-800 px-2 py-1 text-ink-400">
                  {INTENSITY_LABEL[plan.intensity]}
                </span>
              )}
              {plan.cost_estimate && (
                <span className="rounded-md bg-ink-800 px-2 py-1 text-ink-400">
                  {plan.cost_estimate}
                </span>
              )}
              <span className="rounded-md bg-ink-800 px-2 py-1 text-ink-400">
                {plan.days.length} days
              </span>
            </div>

            {plan.best_for && (
              <p className="mt-3 text-sm text-ink-400">
                <span className="text-ink-500">Best for — </span>
                {plan.best_for}
              </p>
            )}

            {vote.revealed && result && (
              <p className="mt-3 text-sm text-jade">
                {result.points} points · {result.firsts} first{' '}
                {result.firsts === 1 ? 'choice' : 'choices'}
              </p>
            )}

            <button
              onClick={() => setOpen(open === plan.id ? null : plan.id)}
              className="mt-4 text-sm text-ink-300 underline decoration-ink-600 underline-offset-4 hover:text-glow"
            >
              {open === plan.id ? 'Hide the day-by-day' : 'See the day-by-day'}
            </button>

            {open === plan.id && (
              <ol className="mt-4 space-y-3 border-t border-ink-800 pt-4">
                {plan.days.map((day) => (
                  <li key={day.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-ink-500">Day {day.day_index + 1}</span>
                      <span className="text-sm font-medium">{day.title}</span>
                    </div>
                    {day.summary && (
                      <p className="mt-1 text-sm leading-relaxed text-ink-400">{day.summary}</p>
                    )}
                    {day.items.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {day.items.map((item, i) => (
                          <li key={i} className="text-sm text-ink-400">
                            <span className="text-ink-600">
                              {item.kind === 'travel' ? '→' : '·'}
                            </span>{' '}
                            {item.title}
                            {item.duration_hours ? (
                              <span className="text-ink-600"> ({item.duration_hours}h)</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {day.warnings.map((w, i) => (
                      <p
                        key={i}
                        className={
                          'mt-1.5 text-xs ' + (w.level === 'clash' ? 'text-coral' : 'text-glow')
                        }
                      >
                        ⚠ {w.message}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            )}
          </article>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}

      <div className="sticky bottom-4 flex items-center gap-3">
        <Button onClick={submitVote} disabled={busy || !rankingComplete} className="flex-1">
          {busy && <Spinner />}
          {rankingComplete
            ? hasVoted
              ? 'Update my ranking'
              : 'Lock in my ranking'
            : `Rank all ${plans.length} to vote (${ranking.length}/${plans.length})`}
        </Button>
        {ranking.length > 0 && (
          <Button variant="ghost" onClick={() => setRanking([])} disabled={busy}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
