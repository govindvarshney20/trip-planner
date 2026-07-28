import Link from 'next/link';
import { JoinByCode } from '@/components/join-by-code';

const PILLARS = [
  {
    title: 'See the group, not just the guesses',
    body: 'Everyone answers a one-minute form. Wayfare shows you where you agree, where you split, and the tensions worth settling before you book anything.',
  },
  {
    title: 'Decisions that actually close',
    body: 'Shortlist, react, vote with a deadline. When the clock runs out the choice is made and it lands in the itinerary. Nothing sits open for three weeks.',
  },
  {
    title: 'A plan that survives contact with reality',
    body: 'We check travel times, opening hours and how much a day can hold. If a plan cannot be done, we say so instead of printing it neatly.',
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-5 pb-24 pt-16 sm:pt-24">
      <header className="mb-14">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-lg">🧭</span>
          <span className="font-display text-lg tracking-wide">Wayfare</span>
        </div>

        <h1 className="font-display text-4xl leading-[1.1] sm:text-6xl">
          Plan the trip together,
          <br />
          <span className="text-glow">and actually decide.</span>
        </h1>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-300 sm:text-lg">
          Group trips die in the group chat. Wayfare gathers what everyone wants, turns it
          into a shortlist you vote on, and builds a day-by-day plan that holds up in the real
          world.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/new"
            className="rounded-lg bg-glow px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffc53d]"
          >
            Start a trip
          </Link>
          <span className="text-sm text-ink-500">Free. No signup for you or your friends.</span>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.title} className="card p-5">
            <h2 className="font-display text-lg leading-snug">{p.title}</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-400">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-display text-lg">Been invited?</h2>
        <p className="mt-1.5 text-sm text-ink-400">
          Enter the code your friend read out, or just open their link.
        </p>
        <div className="mt-4 max-w-sm">
          <JoinByCode />
        </div>
      </section>
    </main>
  );
}
