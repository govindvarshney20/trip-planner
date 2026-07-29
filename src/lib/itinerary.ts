import { researchThenStructure, type Researched } from './gemini';
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

const ITINERARY_SCHEMA: Record<string, unknown> = {
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
          stops: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Specific, named place or leg' },
                kind: { type: 'string', enum: ['activity', 'meal', 'travel', 'stay', 'rest'] },
                locality: { type: 'string' },
                summary: { type: 'string', description: 'One or two sentences' },
                why_included: {
                  type: 'string',
                  description: "One sentence on why it suits THIS group specifically",
                },
                duration_hours: { type: 'number' },
                cost_note: { type: 'string', description: 'Per person, in the trip currency' },
                best_time: { type: 'string' },
              },
              required: ['title'],
            },
          },
        },
        required: ['day_index', 'title'],
      },
    },
  },
  required: ['days'],
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

export async function generateItinerary(
  trip: Trip,
  dna: GroupDna | null,
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

  const structurePrompt = `Using the research notes, build the single best
${dayCount}-day itinerary for this group.

${facts}

Rules for the output:
- Exactly ${dayCount} days, day_index 0 to ${dayCount - 1}. Do not skip a day.
- 3 to 5 stops per day, in the order they happen.
- Include travel legs as stops with kind "travel" and their real duration.
- Group each day geographically. Do not bounce across a city and back.
- Leave the last day light if they are flying out.
- Every stop needs why_included, tied to what this group actually wants.
- Warn on any day that is tight, weather-dependent, or has a long transfer.

Build the plan you would genuinely recommend, not the one that crams in the
most.`;

  return researchThenStructure<{ days: GeneratedDay[] }>(
    researchPrompt,
    structurePrompt,
    ITINERARY_SCHEMA,
    SYSTEM,
  );
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
