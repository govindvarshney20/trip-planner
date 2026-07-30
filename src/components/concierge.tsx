'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Citation, Member } from '@/lib/types';
import { postJson } from '@/lib/fetch-json';
import { Badge, Button, Input, Spinner } from './ui';

export interface ChatMessage {
  id: string;
  member_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  sources: Citation[];
  grounded: boolean;
  created_at: string;
}

const STARTERS = [
  'Is our plan realistic for the days we have?',
  'What should we book before we land?',
  'What will the weather actually be like?',
  'Where should we eat that locals rate?',
];

export function Concierge({
  code,
  initial,
  members,
}: {
  code: string;
  initial: ChatMessage[];
  members: Member[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Counter rather than Date.now(): ids only need to be unique within this
  // list, and a pure source keeps render deterministic.
  const pendingId = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    setInput('');
    setError(null);
    setBusy(true);

    // Show the question immediately; the server assigns the real id.
    const optimistic: ChatMessage = {
      id: `pending-${(pendingId.current += 1)}`,
      member_id: null,
      role: 'user',
      content: q,
      sources: [],
      grounded: false,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);

    try {
      const body = await postJson<{ message: ChatMessage }>(
        `/api/trips/${encodeURIComponent(code)}/ask`,
        { question: q },
      );
      setMessages((m) => [...m, body.message]);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  function authorOf(m: ChatMessage): string {
    if (m.role === 'assistant') return 'Wayfare';
    return members.find((x) => x.id === m.member_id)?.display_name ?? 'Someone';
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-display text-xl">Ask Wayfare</h2>
        <p className="mt-1 text-sm text-ink-400">
          It knows your dates, your group and what&rsquo;s on your board. Everyone on the trip
          sees these answers.
        </p>
      </div>

      {messages.length === 0 && (
        <div className="card p-5">
          <p className="text-sm text-ink-400">Not sure where to start?</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={busy}
                className="rounded-full border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) => (
        <div
          key={m.id}
          className={
            m.role === 'user'
              ? 'ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-ink-800 px-4 py-3'
              : 'card max-w-[92%] p-5'
          }
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs text-ink-500">{authorOf(m)}</span>
            {m.role === 'assistant' && !m.grounded && <Badge tone="warn">unverified</Badge>}
          </div>

          <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-200">
            {m.content}
          </div>

          {m.sources?.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
                {m.sources.length} source{m.sources.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-2 space-y-1">
                {m.sources.slice(0, 6).map((s, i) => (
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
      ))}

      {busy && (
        <div className="card flex items-center gap-3 p-5 text-sm text-ink-400">
          <Spinner />
          Looking it up…
        </div>
      )}

      <div ref={endRef} />

      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this trip…"
          disabled={busy}
          className="bg-ink-900/95 backdrop-blur"
        />
        <Button type="submit" disabled={busy || !input.trim()} className="shrink-0">
          Ask
        </Button>
      </form>
    </div>
  );
}
