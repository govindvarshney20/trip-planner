'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItineraryDay, PlansState, StopWithVotes } from '@/lib/types';
import { postJson } from '@/lib/fetch-json';
import { Button, Spinner } from './ui';
import { StopSheet } from './stop-sheet';

const KIND_MARK: Record<string, string> = {
  activity: '·',
  meal: '🍽',
  travel: '→',
  stay: '🛏',
  rest: '☾',
};

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

  async function generate(force = false) {
    setRetrying(true);
    setError(null);
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

  // Auto-start on first view. Doesn't reuse generate(), which sets state
  // synchronously -- inside an effect that causes cascading renders.
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

  // Someone else may have started generation before we arrived.
  useEffect(() => {
    if (state !== 'generating' || days.length > 0) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [state, days.length, router]);

  /* ---- empty / building ------------------------------------------------- */

  if (days.length === 0) {
    const failed = state === 'failed';
    return (
      <div className="card p-10 text-center">
        {!failed && <Spinner className="mb-4 text-glow" />}
        <h2 className="font-display text-xl">
          {failed ? 'That didn’t work' : 'Building your plan'}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          {failed
            ? 'Something went wrong building your itinerary. Trying again usually sorts it.'
            : `Researching your destination and laying out ${dayCount ?? 'your'} days. About half a minute.`}
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

  // Days with no stops at all is a failed generation wearing a plan's clothes.
  // Say so and offer a rebuild rather than presenting an empty contents page.
  if (totalStops === 0) {
    return (
      <div className="card p-10 text-center">
        <h2 className="font-display text-xl">This plan didn’t build properly</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          We got the shape of your {days.length} days but none of the actual stops. Rebuilding
          usually fixes it.
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
        <h2 className="font-display text-xl">Your plan</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">
          {days.length} days · {totalStops} stops
          {totalTravel > 0 ? ` · ${totalTravel}h in transit` : ''}. Tap a day to see it in
          detail, and any stop for everything worth knowing before you go.
        </p>
      </div>

      {days.map((day) => {
        const isOpen = openDay === day.day_index;
        const heavy = day.travelHours >= 4;

        return (
          <section key={day.day_index} className="card overflow-hidden">
            <button
              onClick={() => setOpenDay(isOpen ? null : day.day_index)}
              aria-expanded={isOpen}
              className="flex w-full items-start gap-4 p-5 text-left transition-colors hover:bg-ink-850/50"
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
                </span>
              </span>

              <span aria-hidden className="mt-1 shrink-0 text-ink-600">
                {isOpen ? '⌃' : '⌄'}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-ink-800 px-5 pb-5 pt-4">
                {day.summary && (
                  <p className="mb-4 text-sm leading-relaxed text-ink-300">{day.summary}</p>
                )}

                {day.warnings.map((w, i) => (
                  <p
                    key={i}
                    className={
                      'mb-2.5 text-sm leading-relaxed ' +
                      (w.level === 'clash' ? 'text-coral' : 'text-glow')
                    }
                  >
                    ⚠ {w.message}
                  </p>
                ))}

                <ol className="mt-1 space-y-1">
                  {day.stops.map((stop) => (
                    <li key={stop.id}>
                      <button
                        onClick={() => setOpenStop(stop)}
                        className="group flex w-full items-baseline gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-ink-850"
                      >
                        <span aria-hidden className="shrink-0 text-ink-600">
                          {KIND_MARK[stop.kind] ?? '·'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink-100 group-hover:text-glow">
                            {stop.title}
                          </span>
                          {stop.summary && (
                            <span className="mt-0.5 line-clamp-2 block text-sm leading-relaxed text-ink-400">
                              {stop.summary}
                            </span>
                          )}
                          <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-500">
                            {stop.duration_hours && <span>{stop.duration_hours}h</span>}
                            {stop.cost_note && <span>{stop.cost_note}</span>}
                            {stop.locality && stop.locality !== day.locality && (
                              <span>{stop.locality}</span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
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
