'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Trip pages read from the database during render, so an outage surfaces here.
 * Without this the user would see a generic crash and assume their link is bad.
 */
export default function TripError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDbDown = error.message.includes('Database unavailable');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <div className="mb-8 flex items-center gap-2">
        <span>🧭</span>
        <span className="font-display tracking-wide">Wayfare</span>
      </div>

      <h1 className="font-display text-2xl">
        {isDbDown ? 'We can’t reach our database' : 'Something went wrong'}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        {isDbDown
          ? 'Your link is fine — this one is on us. Give it a moment and try again.'
          : 'This trip failed to load. Trying again usually sorts it.'}
      </p>

      <div className="mt-6 flex gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-glow px-4 py-2.5 text-sm font-medium text-ink-950 hover:bg-[#ffc53d]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-ink-700 px-4 py-2.5 text-sm text-ink-300 hover:border-ink-500"
        >
          Back to Wayfare
        </Link>
      </div>
    </main>
  );
}
