import {
  askGrounded,
  generateStructured,
  researchThenStructure,
  type Researched,
} from './gemini';
import { dnaToPrompt, type GroupDna } from './dna';
import { formatMonth, tripDays } from './trip-copy';
import type { Trip } from './types';

/**
 * Itinerary generation and per-stop deep detail.
 *
 * Split deliberately into two very different jobs:
 *
 *   generateItinerary  — ONE call, the whole plan skeleton. This is what the
 *                        user waits for, so it must stay a single round trip.
 *   fetchStopDetail    — one call per stop, only when someone opens it, cached
 *                        in Postgres afterwards. Generating detail for ~30
 *                        stops upfront would be minutes of waiting for
 *                        information most people never read.
 */

const SYSTEM = `You are Wayfare's trip architect. You design realistic,
day-by-day itineraries.

Hard rules:
- Everything must be physically possible. Real road times on real roads.
  Mountain and rural routes are slow. A 6 hour transfer occupies 6 hours.
- Never invent a rating, price, or opening time. Omit what the research does
  not support. A blank field is fine; a made-up number is not.
- Name specific places. "Bun cha Huong Lien" beats "a local restaurant".
- Respect dietary constraints absolutely. They are not preferences.
- Include travel legs as their own stops so the day's real shape is visible.
- Flag days that are tight, weather-dependent, or involve a long transfer.
  Being honest about a hard day is more useful than hiding it.
- Plain English. No brochure language, no exclamation marks.`;

export interface GeneratedStop {
  title: string;
  kind?: 'activity' | 'meal' | 'travel' | 'stay' | 'rest';
  locality?: string;
  summary?: string;
  why_included?: string;
  duration_hours?: number;
  cost_note?: string;
  best_time?: string;
}

export interface GeneratedDay {
  day_index: number;
  title: string;
  locality?: string;
  summary?: string;
  warnings?: { level: 'warn' | 'clash'; message: string }[];
  stops?: GeneratedStop[];
}

/**
 * Skeleton schema: the day-level frame only, no stops.
 *
 * Generating the whole itinerary in one call reliably blew past the 60s
 * serverless limit -- two slow grounded passes, and a big JSON payload. So
 * generation is now two stages: one cheap call for this frame (which town on
 * which day), then a small parallel call per day for its stops. No single call
 * is large enough to time out.
 */
const SKELETON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day_index: { type: 'integer', description: '0-based day number' },
          title: { type: 'string', description: 'e.g. "Hanoi to Ha Giang"' },
          locality: { type: 'string', description: 'Where the day is mostly based' },
          summary: { type: 'string', description: 'One or two sentences on the day' },
          warnings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                level: { type: 'string', enum: ['warn', 'clash'] },
                message: { type: 'string' },
              },
              required: ['level', 'message'],
            },
          },
        },
        required: ['day_index', 'title', 'summary'],
      },
    },
  },
  required: ['days'],
};

/** One day's stops. Small output, so the per-day call stays fast. */
const DAY_STOPS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    stops: {
      type: 'array',
      description: 'The things you actually do this day, in order. Never empty.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Specific, named place or leg' },
          kind: { type: 'string', enum: ['activity', 'meal', 'travel', 'stay', 'rest'] },
          locality: { type: 'string' },
          summary: {
            type: 'string',
            description: 'Two or three sentences on what you actually do here',
          },
          why_included: {
            type: 'string',
            description: 'One sentence on why it suits THIS group specifically',
          },
          duration_hours: { type: 'number' },
          cost_note: { type: 'string', description: 'Per person, in the trip currency' },
          best_time: { type: 'string' },
        },
        required: ['title', 'summary', 'duration_hours'],
      },
    },
  },
  required: ['stops'],
};

function tripFacts(trip: Trip, dna: GroupDna | null): string {
  const dayCount = tripDays(trip) ?? 7;
  const when =
    trip.start_date && trip.end_date
      ? `Dates: ${trip.start_date} to ${trip.end_date}`
      : trip.travel_month
        ? `Travelling in: ${formatMonth(trip.travel_month)} (exact dates not fixed)`
        : null;

  const lines = [
    `Destination: ${trip.destination}`,
    `Travellers: ${trip.party_size}`,
    `Length: ${dayCount} days`,
    when,
    trip.budget_level ? `Budget level: ${trip.budget_level}` : null,
    `Quote prices in: ${trip.currency}`,
    trip.brief ? `What they told us: ${trip.brief}` : null,
  ];

  // Preferences are additive. The first plan is generated before anyone has
  // filled them in, and must be good without them.
  if (dna && dna.respondents > 0) {
    lines.push('', 'GROUP PREFERENCES:', dnaToPrompt(dna));
  }

  return lines.filter((l) => l !== null).join('\n');
}

/** Days that are usable: right index, and at least one real stop. */
export function usableDays(days: GeneratedDay[], dayCount: number): GeneratedDay[] {
  return days
    .filter((d) => Number.isInteger(d.day_index) && d.day_index >= 0 && d.day_index < dayCount)
    // The model occasionally repeats a day_index; the primary key would reject
    // the whole batch, so keep the first occurrence.
    .filter((d, i, arr) => arr.findIndex((x) => x.day_index === d.day_index) === i)
    .filter((d) => (d.stops?.length ?? 0) > 0)
    .sort((a, b) => a.day_index - b.day_index);
}

/** Run tasks with a concurrency cap, preserving input order in the results. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * At most this many per-day calls run at once. High enough that a 9-day trip
 * finishes in two waves, low enough not to trip the API's per-minute limit.
 */
const DAY_CONCURRENCY = 5;

/**
 * Generate the itinerary as a skeleton plus one call per day.
 *
 * Stage 1: one grounded research call, reused everywhere.
 * Stage 2: one ungrounded call to lay out which town sits on which day.
 * Stage 3: one small ungrounded call PER DAY for that day's stops, run in
 *          parallel with a concurrency cap.
 *
 * No single call is big or slow enough to approach the 60s function limit, and
 * a day that comes back empty is retried on its own rather than sinking the
 * whole plan. The return shape is unchanged, so the route and UI are untouched.
 */
export async function generateItinerary(
  trip: Trip,
  dna: GroupDna | null,
  opts: { deadline?: number } = {},
): Promise<Researched<{ days: GeneratedDay[] }>> {
  const dayCount = tripDays(trip) ?? 7;
  const facts = tripFacts(trip, dna);

  const researchPrompt = `Research what is needed to build the best possible
${dayCount}-day itinerary for these travellers.

${facts}

Find out:
- the genuinely worthwhile places here, and how long each actually needs
- real travel times between them, by the transport people actually use
- conditions in this month: weather, seasonal access, closures, festivals
- what things cost per person
- what visitors commonly rush or overdo, and what gets unfairly skipped
- where two places are far enough apart that combining them eats a day

Name specific places. Be concrete about hours.`;

  // Stage 1: the one expensive grounded call. Its notes seed every later call.
  const research = await askGrounded(researchPrompt, SYSTEM);
  const notes = `\n\n--- RESEARCH NOTES ---\n${research.text}`;

  // Stage 2: the frame. Which town anchors each day, in what order. No stops
  // yet, so the output is small and the call is quick.
  const skeleton = await generateStructured<{ days: GeneratedDay[] }>(
    `Using the research notes, lay out the shape of the best ${dayCount}-day
itinerary for this group.

${facts}

Give exactly ${dayCount} days, day_index 0 to ${dayCount - 1}, in order. For each
day: a title, the locality it is based in, a one or two sentence summary of the
day, and a warning on any day that is tight, weather-dependent, or has a long
transfer. Group the trip geographically so days flow sensibly and nobody
back-tracks. Do not list individual stops yet.${notes}`,
    SKELETON_SCHEMA,
    SYSTEM,
  );

  // Normalise the frame: valid indices, de-duped, gaps filled so every slot 0..n
  // has a day even if the model skipped one.
  const frame: GeneratedDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const found = (skeleton.days ?? []).find((d) => d.day_index === i);
    frame.push(found ?? { day_index: i, title: `Day ${i + 1}`, summary: '' });
  }

  // Stage 3: fill each day's stops in parallel.
  const dietary = dna?.dietary?.length
    ? `\nHard dietary constraints to honour: ${dna.dietary.join(', ')}.`
    : '';

  const filled = await mapPool(frame, DAY_CONCURRENCY, async (day) => {
    const dayStops = async (extra = '') => {
      const res = await generateStructured<{ stops: GeneratedStop[] }>(
        `Plan day ${day.day_index + 1} of a ${dayCount}-day trip to ${trip.destination}.

This day: ${day.title}${day.locality ? ` (based in ${day.locality})` : ''}.
${day.summary}

Trip context:
${facts}${dietary}

Give 3 to 5 stops for THIS day only, in the order they happen. Each stop needs:
- a specific, named place (not "a local restaurant")
- kind: activity, meal, travel, stay or rest
- a two or three sentence summary of what you actually do there
- why_included: one sentence tying it to what this group wants
- a realistic duration_hours and a per-person cost_note where you can
Include travel legs as stops with kind "travel" and their real duration.${extra}${notes}`,
        DAY_STOPS_SCHEMA,
        SYSTEM,
      );
      return res.stops ?? [];
    };

    let stops = await dayStops();

    // A single empty day is cheap to redo on its own, and there is usually time
    // because the other days are running in parallel.
    if (stops.length === 0) {
      const timeLeft = opts.deadline ? opts.deadline - Date.now() : Infinity;
      if (timeLeft > 12_000) {
        stops = await dayStops('\nYour previous attempt returned no stops. Return 3 to 5.');
      }
    }

    return { ...day, stops };
  });

  return {
    data: { days: filled },
    sources: research.sources,
    grounded: research.grounded,
  };
}

/* -------------------------------------------------------------------------
 * Per-stop deep detail
 * ---------------------------------------------------------------------- */

export interface StopDetail {
  what_it_is?: string;
  what_people_say?: string;
  rating?: number;
  rating_count?: number;
  fees?: string;
  opening_hours?: string;
  best_time?: string;
  duration_hours?: number;
  tips?: string[];
  watch_out_for?: string[];
  getting_there?: string;
}

const DETAIL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    what_it_is: { type: 'string', description: 'Two or three sentences' },
    what_people_say: {
      type: 'string',
      description:
        'Summary of recurring praise and recurring complaints from reviews. Never quote review text verbatim.',
    },
    rating: { type: 'number', description: 'Out of 5. Only if the research reports one' },
    rating_count: { type: 'integer', description: 'Only if the research reports one' },
    fees: { type: 'string', description: 'Entry or booking cost per person' },
    opening_hours: { type: 'string' },
    best_time: { type: 'string', description: 'Time of day or conditions' },
    duration_hours: { type: 'number' },
    tips: { type: 'array', items: { type: 'string' }, description: '2-4 practical tips' },
    watch_out_for: {
      type: 'array',
      items: { type: 'string' },
      description: 'Scams, closures, crowds, anything that spoils a visit',
    },
    getting_there: { type: 'string' },
  },
};

/**
 * Everything a traveller wants before committing to a stop.
 *
 * `what_people_say` is a synthesised summary with citations, never verbatim
 * review text -- reproducing review bodies from Google or TripAdvisor is
 * against their terms and breaks the moment they change their markup.
 */
export async function fetchStopDetail(
  trip: Trip,
  stop: { title: string; locality: string | null; kind: string },
): Promise<Researched<StopDetail>> {
  const where = stop.locality ? `${stop.locality}, ${trip.destination}` : trip.destination;
  const month = formatMonth(trip.travel_month);

  const researchPrompt = `Research "${stop.title}" in ${where} for a traveller
deciding whether to include it.

Find:
- what it actually is, and what the experience is like
- how visitors rate it, roughly how many reviews, and what the recurring praise
  and recurring complaints are
- entry or booking cost per person${trip.currency ? `, ideally in ${trip.currency}` : ''}
- opening hours, and any days it is closed
- how long people actually spend there
- the best time of day or conditions to go${month ? `, particularly in ${month}` : ''}
- how to get there
- anything that commonly spoils a visit: crowds, scams, closures, weather

Party of ${trip.party_size}. Report only what you find; do not fill gaps with
plausible guesses.`;

  const structurePrompt = `Turn the research notes into structured detail for
"${stop.title}".

Omit any field the notes do not support -- especially rating, rating_count and
fees. For what_people_say, summarise the recurring themes in your own words.
Never reproduce review text verbatim.`;

  return researchThenStructure<StopDetail>(
    researchPrompt,
    structurePrompt,
    DETAIL_SCHEMA,
    SYSTEM,
  );
}

/* -------------------------------------------------------------------------
 * Links out
 *
 * We deliberately do not fetch or host images. A link to Google Images always
 * has coverage, costs nothing, and needs no API key -- and Maps is where people
 * want to end up anyway.
 * ---------------------------------------------------------------------- */

export function googleImagesUrl(title: string, locality: string | null): string {
  const q = [title, locality].filter(Boolean).join(' ');
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}

export function googleMapsUrl(title: string, locality: string | null): string {
  const q = [title, locality].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
