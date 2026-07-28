'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui';

/**
 * The invite link carries the trip's invite token, so it is a credential.
 * The join code is the read-aloud fallback.
 *
 * The full URL is resolved on the server and passed in, rather than read from
 * `window` after mount. That avoids both a hydration mismatch and an empty
 * input on first paint.
 */
export function InviteBar({ joinCode, inviteUrl }: { joinCode: string; inviteUrl: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      // Clipboard is blocked in some mobile webviews; the input below is
      // selectable as a fallback so the user is never stuck.
    }
  }

  return (
    <div className="card mt-5 flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-500">Invite your friends</p>
        <input
          readOnly
          value={inviteUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invite link"
          className="mt-0.5 w-full bg-transparent text-sm text-ink-300 outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <span
          className="rounded-md bg-ink-800 px-2 py-1 font-mono text-xs tracking-wider text-ink-300"
          title="Or read this code out"
        >
          {joinCode}
        </span>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </div>
  );
}
