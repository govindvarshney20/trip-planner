import { CreateForm } from '@/components/create-form';
import { JoinByCode } from '@/components/join-by-code';

export const dynamic = 'force-dynamic';

const STEPS = [
  {
    n: '01',
    title: 'Tell us where and when',
    body: 'A destination and a rough month is enough. Exact dates can wait until you book.',
  },
  {
    n: '02',
    title: 'Get a real plan',
    body: 'A day-by-day itinerary with honest travel times, what each place costs, and why it made the cut.',
  },
  {
    n: '03',
    title: 'Shape it together',
    body: 'Send one link. Your friends vote, swap places for alternatives, and reorder days with you.',
  },
];

export default function Home() {
  // Passed in rather than read inside the client component, so the month list
  // is deterministic for a given render.
  const now = new Date().toISOString();

  return (
    <main className="mx-auto max-w-5xl px-5 pb-20 pt-10 sm:pt-16">
      <div className="mb-10 flex items-center gap-2">
        <span className="text-lg">🧭</span>
        <span className="font-display text-lg tracking-wide">Wayfare</span>
      </div>

      {/*
        DOM order is the mobile order: headline, form, then how-it-works. The
        form is the product, so on a phone it sits directly under the promise
        rather than below three paragraphs of explanation. On desktop explicit
        grid placement moves it into its own column without reordering markup.
      */}
      <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,400px)] lg:gap-14">
        <header className="lg:col-start-1 lg:row-start-1">
          <h1 className="font-display text-[2.5rem] leading-[1.08] sm:text-5xl lg:text-[3.4rem]">
            Tell us where.
            <br />
            <span className="text-glow">We&rsquo;ll plan the rest.</span>
          </h1>

          <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-300 sm:text-lg">
            A complete day-by-day plan in under a minute — then your friends vote, swap and shape
            it with you. No more planning a trip in a group chat.
          </p>
        </header>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="lg:sticky lg:top-8">
            <CreateForm monthsFrom={now} />
          </div>
        </div>

        <section className="lg:col-start-1 lg:row-start-2">
          <ol className="space-y-5">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-4">
                <span className="mt-0.5 font-display text-sm text-ink-600">{s.n}</span>
                <div>
                  <h2 className="text-sm font-medium text-ink-100">{s.title}</h2>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-400">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10">
            <p className="text-xs uppercase tracking-wide text-ink-600">Been invited?</p>
            <div className="mt-2.5 max-w-xs">
              <JoinByCode />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
