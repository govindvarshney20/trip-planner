'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItineraryDay, StopKind, StopVoteValue, StopWithVotes } from '@/lib/types';
import { postJson } from '@/lib/fetch-json';
import { Button, Input, Select, Spinner } from './ui';

const KIND_MARK: Record<string, string> = {
  activity: '·',
  meal: '🍽',
  travel: '→',
  stay: '🛏',
  rest: '☾',
};

/**
 * One expanded day: its stops with curation controls (vote, reorder, remove,
 * add). Each action hits its API and refreshes; votes are optimistic so they
 * feel instant, structural changes refresh from the server truth.
 */
export function DayEditor({
  code,
  day,
  onOpenStop,
}: {
  code: string;
  day: ItineraryDay;
  onOpenStop: (stop: StopWithVotes) => void;
}) {
  const router = useRouter();
  const [voteOverride, setVoteOverride] = useState<Record<string, StopVoteValue | null>>({});
  const [undo, setUndo] = useState<StopWithVotes | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const base = `/api/trips/${encodeURIComponent(code)}/plan`;

  async function vote(stop: StopWithVotes, value: StopVoteValue) {
    const current = stop.id in voteOverride ? voteOverride[stop.id] : stop.myVote;
    const next = current === value ? null : value;
    setVoteOverride((v) => ({ ...v, [stop.id]: next }));
    try {
      await postJson(`${base}/stops/${stop.id}/vote`, { value: next });
      router.refresh();
    } catch {
      // Roll the optimistic change back on failure.
      setVoteOverride((v) => ({ ...v, [stop.id]: current }));
    }
  }

  async function remove(stop: StopWithVotes) {
    setUndo(stop);
    setBusy(true);
    try {
      await postJson(`${base}/stops/${stop.id}`, { status: 'removed' }, 'PATCH');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function undoRemove() {
    if (!undo) return;
    const stop = undo;
    setUndo(null);
    await postJson(`${base}/stops/${stop.id}`, { status: 'proposed' }, 'PATCH');
    router.refresh();
  }

  async function move(stop: StopWithVotes, dir: -1 | 1) {
    const ids = day.stops.map((s) => s.id);
    const i = ids.indexOf(stop.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusy(true);
    try {
      await postJson(`${base}/days/${day.day_index}/reorder`, { stopIds: ids });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const myVote = (stop: StopWithVotes): StopVoteValue | null =>
    stop.id in voteOverride ? voteOverride[stop.id] : stop.myVote;

  return (
    <div className="border-t border-ink-800 px-4 pb-5 pt-4 sm:px-5">
      {day.summary && <p className="mb-4 text-sm leading-relaxed text-ink-300">{day.summary}</p>}

      {day.warnings.map((w, i) => (
        <p
          key={i}
          className={
            'mb-2.5 text-sm leading-relaxed ' + (w.level === 'clash' ? 'text-coral' : 'text-glow')
          }
        >
          ⚠ {w.message}
        </p>
      ))}

      <ol className="mt-1 space-y-1">
        {day.stops.map((stop, i) => {
          // Highlight reflects the optimistic choice; counts stay server-truth
          // and settle on the next refresh, so they can never read wrong.
          const mine = myVote(stop);
          return (
            <li key={stop.id} className="rounded-lg px-1 py-1.5 hover:bg-ink-850/60">
              <div className="flex items-start gap-2">
                <button
                  onClick={() => onOpenStop(stop)}
                  className="group flex min-w-0 flex-1 items-baseline gap-3 text-left"
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
                    </span>
                  </span>
                </button>

                {/* reorder */}
                <div className="flex shrink-0 flex-col text-ink-600">
                  <button
                    aria-label="Move up"
                    disabled={i === 0 || busy}
                    onClick={() => move(stop, -1)}
                    className="px-1 leading-none hover:text-ink-200 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    aria-label="Move down"
                    disabled={i === day.stops.length - 1 || busy}
                    onClick={() => move(stop, 1)}
                    className="px-1 leading-none hover:text-ink-200 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* vote + remove */}
              <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                <button
                  onClick={() => vote(stop, 'keep')}
                  aria-pressed={mine === 'keep'}
                  className={
                    'rounded-full border px-2 py-0.5 text-xs transition-colors ' +
                    (mine === 'keep'
                      ? 'border-jade/50 bg-[rgba(63,185,132,0.14)] text-jade'
                      : 'border-ink-700 text-ink-400 hover:border-ink-500')
                  }
                >
                  👍 {stop.keeps || ''}
                </button>
                <button
                  onClick={() => vote(stop, 'drop')}
                  aria-pressed={mine === 'drop'}
                  className={
                    'rounded-full border px-2 py-0.5 text-xs transition-colors ' +
                    (mine === 'drop'
                      ? 'border-coral/50 bg-[rgba(242,118,94,0.14)] text-coral'
                      : 'border-ink-700 text-ink-400 hover:border-ink-500')
                  }
                >
                  👎 {stop.drops || ''}
                </button>
                <button
                  onClick={() => remove(stop)}
                  disabled={busy}
                  className="ml-auto rounded-full border border-ink-800 px-2 py-0.5 text-xs text-ink-500 hover:border-coral/50 hover:text-coral disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {undo && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2 text-sm">
          <span className="text-ink-300">Removed “{undo.title}”.</span>
          <button onClick={undoRemove} className="font-medium text-glow hover:underline">
            Undo
          </button>
        </div>
      )}

      {adding ? (
        <AddStopForm
          code={code}
          dayIndex={day.day_index}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 text-sm text-ink-400 hover:text-glow"
        >
          + Add a stop
        </button>
      )}
    </div>
  );
}

function AddStopForm({
  code,
  dayIndex,
  onDone,
  onCancel,
}: {
  code: string;
  dayIndex: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<StopKind>('activity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/trips/${encodeURIComponent(code)}/plan/days/${dayIndex}/add`, {
        title: title.trim(),
        kind,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-ink-800 p-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add your own stop — a place, a meal, a break…"
        autoFocus
        maxLength={160}
      />
      <div className="flex items-center gap-2">
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as StopKind)}
          className="w-auto"
        >
          <option value="activity">Activity</option>
          <option value="meal">Meal</option>
          <option value="travel">Travel</option>
          <option value="stay">Stay</option>
          <option value="rest">Rest</option>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          {busy && <Spinner />}
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
    </form>
  );
}
