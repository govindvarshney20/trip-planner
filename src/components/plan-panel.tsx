'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItineraryDay, PlansState, StopWithVotes } from '@/lib/types';
import { postJson } from '@/lib/fetch-json';
import { Button, Spinner } from './ui';
import { StopSheet } from './stop-sheet';
import { DayEditor } from './day-editor';

/** How many day-stop requests the browser fires at once. */
const FILL_CONCURRENCY = 3;

export function PlanPanel({
  code,
  days,
  state,
  dayCount,
}: {
  code: string;
  days: ItineraryDay[];
  state: PlansState;
  dayCount: number | null;
}) {
  const router = useRouter();
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [openStop, setOpenStop] = useState<StopWithVotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const kickedOff = useRef(false);

  // Per-day fill bookkeeping, held as state because the render depends on it:
  // filling = requests in flight; attempted = days already tried this session
  // (so an empty day isn't retried forever). Sets of day_index.
  const [filling, setFilling] = useState<ReadonlySet<number>>(() => new Set());
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(() => new Set());

  const startFill = (idx: number) =>
    setFilling((prev) => new Set(prev).add(idx));
  const finishFill = (idx: number) => {
    setAttempted((prev) => new Set(prev).add(idx));
    setFilling((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  async function generate(force = false) {
    setRetrying(true);
    setError(null);
    if (force) {
      setFilling(new Set());
      setAttempted(new Set());
    }
    try {
      await postJson(`/api/trips/${encodeURIComponent(code)}/plan/generate`, { force });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      // A timeout often means the work finished server-side just after the
      // gateway gave up, so pull fresh state rather than leaving a dead spinner.
      router.refresh();
    } finally {
      setRetrying(false);
    }
  }

  // Auto-start the skeleton on first view. Doesn't reuse generate(), which sets
  // state synchronously -- inside an effect that causes cascading renders.
  useEffect(() => {
    if (kickedOff.current) return;
    if (state !== 'none' || days.length > 0) return;
    kickedOff.current = true;

    let cancelled = false;
    void (async () => {
      try {
        await postJson(`/api/trips/${encodeURIComponent(code)}/plan/generate`, {});
        if (!cancelled) router.refresh();
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        router.refresh();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state, days.length, code, router]);

  // Someone else may have started the skeleton before we arrived.
  useEffect(() => {
    if (state !== 'generating' || days.length > 0) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [state, days.length, router]);

  // Fill stops per day, a few at a time. Runs whenever the day list or the
  // in-flight set changes: each completion frees a slot and each refresh brings
  // newly-filled days, so this drains the queue at the concurrency cap until
  // every empty day has been attempted. Each day moves pending -> filling ->
  // attempted exactly once, so it terminates.
  useEffect(() => {
    if (days.length === 0) return;
    const slots = FILL_CONCURRENCY - filling.size;
    if (slots <= 0) return;

    const toStart = days
      .filter((d) => d.stops.length === 0)
      .map((d) => d.day_index)
      .filter((i) => !attempted.has(i) && !filling.has(i))
      .slice(0, slots);
    if (toStart.length === 0) return;

    toStart.forEach((idx) => {
      startFill(idx);
      void (async () => {
        try {
          await postJson(`/api/trips/${encodeURIComponent(code)}/plan/days/${idx}/stops`);
        } catch {
          // Leave it for a manual per-day retry rather than blocking the rest.
        } finally {
          finishFill(idx);
          router.refresh();
        }
      })();
    });
  }, [days, filling, attempted, code, router]);

  // Warm the per-stop detail cache when a day is opened, so tapping a stop is
  // near-instant instead of a ~15s live lookup. Fire-and-forget, low
  // concurrency; each place is researched once ever and cached server-side, so
  // the on-tap fetch then returns immediately.
  useEffect(() => {
    if (openDay === null) return;
    const day = days.find((d) => d.day_index === openDay);
    if (!day) return;
    const targets = day.stops.filter((s) => !s.detail).slice(0, 4);
    if (targets.length === 0) return;

    let cancelled = false;
    const queue = [...targets];
    const worker = async () => {
      while (!cancelled && queue.length) {
        const s = queue.shift();
        if (!s) return;
        try {
          await postJson(`/api/trips/${encodeURIComponent(code)}/plan/stops/${s.id}/detail`);
        } catch {
          // Best-effort warming; a real failure surfaces when the user taps.
        }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [openDay, days, code]);

  async function retryDay(idx: number) {
    setAttempted((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
    startFill(idx);
    try {
      await postJson(`/api/trips/${encodeURIComponent(code)}/plan/days/${idx}/stops`);
    } finally {
      finishFill(idx);
      router.refresh();
    }
  }

  /* ---- no skeleton yet -------------------------------------------------- */

  if (days.length === 0) {
    const failed = state === 'failed';
    return (
      <div className="card p-10 text-center">
        {!failed && <Spinner className="mb-4 text-glow" />}
        <h2 className="font-display text-xl">
          {failed ? 'That didn’t work' : 'Laying out your trip'}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          {failed
            ? 'Something went wrong starting your itinerary. Trying again usually sorts it.'
            : `Shaping ${dayCount ?? 'your'} days. This part is quick — the days fill in after.`}
        </p>
        {(failed || state === 'none') && (
          <Button onClick={() => generate(true)} disabled={retrying} className="mt-5">
            {retrying && <Spinner />}
            {retrying ? 'Working…' : 'Try again'}
          </Button>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-coral">
            {error}
          </p>
        )}
      </div>
    );
  }

  /* ---- overview + day detail -------------------------------------------- */

  const totalStops = days.reduce((n, d) => n + d.stops.length, 0);
  const totalTravel = Math.round(days.reduce((n, d) => n + d.travelHours, 0) * 10) / 10;
  const readyDays = days.filter((d) => d.stops.length > 0).length;
  const stillFilling = filling.size > 0 || readyDays < days.length;
  const allAttempted = days.every(
    (d) => d.stops.length > 0 || attempted.has(d.day_index),
  );

  // Every day attempted and still nothing anywhere: the whole thing failed, not
  // just one day. Offer a full rebuild.
  if (totalStops === 0 && allAttempted && filling.size === 0) {
    return (
      <div className="card p-10 text-center">
        <h2 className="font-display text-xl">This plan didn’t build properly</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          We laid out your {days.length} days but couldn’t fill any of them. Rebuilding usually
          fixes it.
        </p>
        <Button onClick={() => generate(true)} disabled={retrying} className="mt-5">
          {retrying && <Spinner />}
          {retrying ? 'Rebuilding…' : 'Rebuild my plan'}
        </Button>
        {error && (
          <p role="alert" className="mt-4 text-sm text-coral">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Your plan</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-400">
              {days.length} days · {totalStops} stops
              {totalTravel > 0 ? ` · ${totalTravel}h in transit` : ''}. Tap a day to open it, and
              any stop for the full detail.
            </p>
          </div>
          {stillFilling && (
            <span className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
              <Spinner className="text-glow" />
              {readyDays}/{days.length}
            </span>
          )}
        </div>
      </div>

      {days.map((day) => {
        const isOpen = openDay === day.day_index;
        const heavy = day.travelHours >= 4;
        const isFilling = filling.has(day.day_index);
        const isEmpty = day.stops.length === 0;
        const failedDay = isEmpty && !isFilling && attempted.has(day.day_index);

        return (
          <section key={day.day_index} className="card overflow-hidden">
            <button
              onClick={() => !isEmpty && setOpenDay(isOpen ? null : day.day_index)}
              aria-expanded={isOpen}
              disabled={isEmpty}
              className="flex w-full items-start gap-4 p-5 text-left transition-colors enabled:hover:bg-ink-850/50 disabled:cursor-default"
            >
              <span className="mt-0.5 shrink-0 font-display text-sm text-ink-600">
                {String(day.day_index + 1).padStart(2, '0')}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg leading-snug">{day.title}</span>
                {day.summary && !isOpen && (
                  <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-ink-400">
                    {day.summary}
                  </span>
                )}
                <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-500">
                  {isFilling ? (
                    <span className="flex items-center gap-1.5 text-glow">
                      <Spinner /> planning this day…
                    </span>
                  ) : failedDay ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void retryDay(day.day_index);
                      }}
                      className="cursor-pointer text-coral underline underline-offset-2"
                    >
                      couldn’t plan this day — retry
                    </span>
                  ) : (
                    <>
                      <span>{day.stops.length} stops</span>
                      {day.travelHours > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <span className={heavy ? 'text-glow' : undefined}>
                            {day.travelHours}h travel
                          </span>
                        </>
                      )}
                      {day.warnings.length > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-glow">
                            {day.warnings.length} thing{day.warnings.length > 1 ? 's' : ''} to know
                          </span>
                        </>
                      )}
                    </>
                  )}
                </span>
              </span>

              {!isEmpty && (
                <span aria-hidden className="mt-1 shrink-0 text-ink-600">
                  {isOpen ? '⌃' : '⌄'}
                </span>
              )}
            </button>

            {isOpen && !isEmpty && (
              <DayEditor code={code} day={day} onOpenStop={setOpenStop} />
            )}
          </section>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}

      {openStop && (
        <StopSheet code={code} stop={openStop} onClose={() => setOpenStop(null)} />
      )}
    </div>
  );
}
