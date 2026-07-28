'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroupDna } from '@/lib/dna';
import type { Member, ReactionValue, ScoredIdea } from '@/lib/types';
import { Badge, Button, Input, Spinner } from './ui';

const REACTIONS: { v: ReactionValue; emoji: string; label: string }[] = [
  { v: 'must', emoji: '🔥', label: 'Must do' },
  { v: 'keen', emoji: '👍', label: 'Keen' },
  { v: 'meh', emoji: '😐', label: 'Meh' },
  { v: 'no', emoji: '❌', label: 'Rather not' },
];

export function IdeasBoard({
  code,
  ideas,
  me,
  members,
  dna,
}: {
  code: string;
  ideas: ScoredIdea[];
  me: Member;
  members: Member[];
  dna: GroupDna;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, ReactionValue | null>>({});

  const needsPrefs = dna.respondents === 0;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(code)}/ideas/suggest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 8, focus: focus.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not fetch suggestions');
      if (body.added === 0) {
        setError('Nothing new came back. Try narrowing it with a focus, like "food in Hanoi".');
      }
      setFocus('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function react(ideaId: string, value: ReactionValue) {
    const mine = ideas.find((i) => i.id === ideaId)?.reactions.find((r) => r.member_id === me.id);
    const next = mine?.value === value ? null : value;

    // Optimistic: the button responds now, the server catches up.
    setPending((p) => ({ ...p, [ideaId]: next }));
    try {
      await fetch(`/api/trips/${encodeURIComponent(code)}/react`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea_id: ideaId, value: next }),
      });
      router.refresh();
    } catch {
      setPending((p) => {
        const copy = { ...p };
        delete copy[ideaId];
        return copy;
      });
    }
  }

  function myReaction(idea: ScoredIdea): ReactionValue | null {
    if (idea.id in pending) return pending[idea.id];
    return idea.reactions.find((r) => r.member_id === me.id)?.value ?? null;
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-display text-xl">The shortlist</h2>
        <p className="mt-1 text-sm text-ink-400">
          {needsPrefs
            ? 'Fill in your preferences first and these get a lot sharper.'
            : 'Suggestions are built from your group’s answers. React to sort them.'}
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="Optional focus — e.g. street food in Hanoi, or rainy day options"
            disabled={busy}
          />
          <Button onClick={generate} disabled={busy} className="shrink-0">
            {busy && <Spinner />}
            {busy ? 'Researching…' : 'Suggest ideas'}
          </Button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-coral">
            {error}
          </p>
        )}
      </div>

      {ideas.length === 0 && !busy && (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-400">
            Nothing on the board yet. Hit <span className="text-ink-200">Suggest ideas</span> and
            we&rsquo;ll go find some.
          </p>
        </div>
      )}

      {ideas.map((idea) => {
        const mine = myReaction(idea);
        return (
          <article key={idea.id} className="card card-hover p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-lg leading-snug">{idea.title}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                  {idea.locality && <span>{idea.locality}</span>}
                  <span>·</span>
                  <span>{idea.category}</span>
                  {idea.duration_hours && (
                    <>
                      <span>·</span>
                      <span>{idea.duration_hours}h</span>
                    </>
                  )}
                  {idea.price_note && (
                    <>
                      <span>·</span>
                      <span>{idea.price_note}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-right">
                {idea.rating != null && (
                  <div className="text-sm">
                    <span className="text-glow">★</span> {idea.rating}
                    {idea.rating_count != null && (
                      <span className="ml-1 text-xs text-ink-500">
                        ({idea.rating_count.toLocaleString()})
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-end gap-1">
                  {!idea.grounded && <Badge tone="warn">unverified</Badge>}
                  {idea.contested && <Badge tone="bad">contested</Badge>}
                </div>
              </div>
            </div>

            {idea.description && (
              <p className="mt-3 text-sm leading-relaxed text-ink-300">{idea.description}</p>
            )}

            {idea.why_fits && (
              <p className="mt-2 text-sm leading-relaxed text-ink-400">
                <span className="text-ink-500">Why you — </span>
                {idea.why_fits}
              </p>
            )}

            {idea.best_time && (
              <p className="mt-2 text-xs text-ink-500">Best time: {idea.best_time}</p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1">
                {REACTIONS.map((r) => (
                  <button
                    key={r.v}
                    onClick={() => react(idea.id, r.v)}
                    title={r.label}
                    aria-label={r.label}
                    aria-pressed={mine === r.v}
                    className={
                      'rounded-lg border px-2.5 py-1.5 text-sm transition-colors ' +
                      (mine === r.v
                        ? 'border-glow bg-[rgba(240,180,41,0.14)]'
                        : 'border-ink-800 hover:border-ink-600')
                    }
                  >
                    {r.emoji}
                    <span className="ml-1 text-xs text-ink-500">
                      {idea.reactions.filter((x) => x.value === r.v).length || ''}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 text-xs text-ink-500">
                <span>
                  {idea.votesIn}/{members.length} voted
                </span>
                {idea.booking_url && (
                  <a
                    href={idea.booking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-300 underline decoration-ink-600 underline-offset-2 hover:text-glow"
                  >
                    Book
                  </a>
                )}
              </div>
            </div>

            {idea.sources.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
                  {idea.sources.length} source{idea.sources.length > 1 ? 's' : ''}
                </summary>
                <ul className="mt-2 space-y-1">
                  {idea.sources.slice(0, 5).map((s, i) => (
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
          </article>
        );
      })}
    </div>
  );
}
