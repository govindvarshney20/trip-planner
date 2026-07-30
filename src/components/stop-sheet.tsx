'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { googleImagesUrl, googleMapsUrl } from '@/lib/itinerary';
import { postJson } from '@/lib/fetch-json';
import type { Citation, StopDetail, StopWithVotes } from '@/lib/types';
import { Badge, Button, Input, Spinner } from './ui';

/**
 * The stop deep-dive.
 *
 * Detail is fetched the first time this opens and cached server-side, so the
 * itinerary itself stays one fast Gemini call and the expensive per-place
 * research only happens for stops someone actually cares about.
 */
export function StopSheet({
  code,
  stop,
  onClose,
}: {
  code: string;
  stop: StopWithVotes;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StopDetail | null>(stop.detail);
  const [sources, setSources] = useState<Citation[]>(stop.detail_sources ?? []);
  const [grounded, setGrounded] = useState(stop.detail_grounded);
  const [loading, setLoading] = useState(!stop.detail);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(stop.title);
  const [dur, setDur] = useState(stop.duration_hours?.toString() ?? '');
  const [cost, setCost] = useState(stop.cost_note ?? '');
  const [busy, setBusy] = useState(false);

  const base = `/api/trips/${encodeURIComponent(code)}/plan/stops/${stop.id}`;

  async function saveEdit() {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        base,
        {
          title: title.trim() || stop.title,
          duration_hours: dur.trim() ? Number(dur) : null,
          cost_note: cost.trim() || null,
        },
        'PATCH',
      );
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function removeStop() {
    setBusy(true);
    try {
      await postJson(base, { status: 'removed' }, 'PATCH');
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  // Escape to close, and don't let the page scroll behind the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (stop.detail) return;

    let cancelled = false;
    void (async () => {
      try {
        const body = await postJson<{
          detail: StopDetail;
          sources: Citation[];
          grounded: boolean;
        }>(`/api/trips/${encodeURIComponent(code)}/plan/stops/${stop.id}/detail`);
        if (cancelled) return;
        setDetail(body.detail);
        setSources(body.sources ?? []);
        setGrounded(!!body.grounded);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, stop.id, stop.detail]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={stop.title}
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />

      <div className="relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-ink-800 bg-ink-900 sm:rounded-2xl">
        <div className="sticky top-0 flex items-start gap-3 border-b border-ink-800 bg-ink-900/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-snug">{stop.title}</h2>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-500">
              {stop.locality && <span>{stop.locality}</span>}
              <span>{stop.kind}</span>
              {stop.duration_hours && <span>{stop.duration_hours}h</span>}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-lg px-2 py-1 text-ink-500 hover:bg-ink-850 hover:text-ink-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {editing ? (
            <div className="space-y-2.5 rounded-lg border border-ink-800 p-3">
              <label className="block text-xs uppercase tracking-wide text-ink-500">Name</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
              <div className="flex gap-2">
                <Input
                  value={dur}
                  onChange={(e) => setDur(e.target.value)}
                  type="number"
                  min={0}
                  placeholder="Hours"
                  className="w-24"
                />
                <Input
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="Cost per person"
                  maxLength={120}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={saveEdit} disabled={busy}>
                  {busy && <Spinner />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={removeStop}
                disabled={busy}
                className="text-ink-400 hover:text-coral"
              >
                Remove from plan
              </Button>
            </div>
          )}

          {stop.why_included && !editing && (
            <p className="text-sm leading-relaxed text-ink-300">
              <span className="text-ink-500">Why it’s in your plan — </span>
              {stop.why_included}
            </p>
          )}

          {loading && (
            <div className="flex items-center gap-3 py-6 text-sm text-ink-400">
              <Spinner />
              Looking this one up…
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          )}

          {detail && (
            <>
              {(detail.rating != null || !grounded) && (
                <div className="flex items-center gap-3">
                  {detail.rating != null && (
                    <span className="text-sm">
                      <span className="text-glow">★</span> {detail.rating}
                      {detail.rating_count != null && (
                        <span className="ml-1 text-xs text-ink-500">
                          ({detail.rating_count.toLocaleString()} reviews)
                        </span>
                      )}
                    </span>
                  )}
                  {!grounded && <Badge tone="warn">unverified</Badge>}
                </div>
              )}

              {detail.what_it_is && (
                <p className="text-sm leading-relaxed text-ink-200">{detail.what_it_is}</p>
              )}

              {detail.what_people_say && (
                <Section title="What people say">{detail.what_people_say}</Section>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label="Cost" value={detail.fees ?? stop.cost_note} />
                <Fact label="Time needed" value={hours(detail.duration_hours ?? stop.duration_hours)} />
                <Fact label="Opening hours" value={detail.opening_hours} />
                <Fact label="Best time" value={detail.best_time ?? stop.best_time} />
              </dl>

              {detail.getting_there && (
                <Section title="Getting there">{detail.getting_there}</Section>
              )}

              {detail.tips && detail.tips.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs uppercase tracking-wide text-ink-500">
                    Worth knowing
                  </h3>
                  <ul className="space-y-1.5">
                    {detail.tips.map((t, i) => (
                      <li key={i} className="text-sm leading-relaxed text-ink-300">
                        · {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.watch_out_for && detail.watch_out_for.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs uppercase tracking-wide text-ink-500">
                    Watch out for
                  </h3>
                  <ul className="space-y-1.5">
                    {detail.watch_out_for.map((t, i) => (
                      <li key={i} className="text-sm leading-relaxed text-glow">
                        ⚠ {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* We don't host images -- Google always has coverage, costs nothing,
              and Maps is where people want to end up anyway. */}
          <div className="flex flex-wrap gap-2 border-t border-ink-800 pt-4">
            <OutLink href={googleImagesUrl(stop.title, stop.locality)}>Photos</OutLink>
            <OutLink href={googleMapsUrl(stop.title, stop.locality)}>Maps</OutLink>
          </div>

          {sources.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
                {sources.length} source{sources.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-2 space-y-1">
                {sources.slice(0, 8).map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-ink-400 underline decoration-ink-700 underline-offset-2 hover:text-glow"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function hours(v: number | null | undefined): string | null {
  return v ? `${v}h` : null;
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-200">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs uppercase tracking-wide text-ink-500">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-300">{children}</p>
    </div>
  );
}

function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
    >
      {children} ↗
    </a>
  );
}
