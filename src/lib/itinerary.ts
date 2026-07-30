import { generateStructured, researchThenStructure, type Researched } from './gemini';
import { dnaToPrompt, type GroupDna } from './dna';
import { formatMonth, tripDays } from './trip-copy';
import type { Trip } from './types';

/**
 * Itinerary generation and per-stop deep detail.
 *
 * Generation is spread across requests so no single one can time out:
 *
 *   generateSkeleton  — fast, ungrounded: which town anchors each day. Returned
 *                       by /plan/generate so the day cards show at once.
 *   generateDayStops  — grounded, one day per request from the browser. Days
 *                       stream in.
 *   fetchStopDetail   — one call per stop, only when someone opens it, cached
 *                       in Postgres afterwards.
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

/**
 * The itinerary is built across SEPARATE HTTP requests, not one.
 *
 * Doing research + skeleton + every day inside a single request meant the whole
 * chain had to finish within one 60s serverless invocation, and the grounded
 * research call alone could eat most of that. Splitting the calls up inside one
 * request did not help: the total was still one request against one 60s budget.
 *
 * So generation is now:
 *   generateSkeleton   — one FAST ungrounded call. Which town anchors each day.
 *                        Returned by /plan/generate; the day cards show at once.
 *   generateDayStops   — one grounded call PER DAY, each its own request from the
 *                        browser with its own 60s budget. Days stream in.
 *
 * No request does more than one day of grounded work, so none can time out. And
 * a per-day search ("best things to do in Ha Giang") grounds better than one
 * giant search for the whole trip.
 */

/**
 * The day-level frame. Ungrounded on purpose: a model knows the geography of a
 * region well enough to say "days 3-5 are the Ha Giang loop" without a search,
 * and skipping the grounded call is what keeps this well under the limit.
 */
export async function generateSkeleton(
  trip: Trip,
  dna: GroupDna | null,
): Promise<GeneratedDay[]> {
  const dayCount = tripDays(trip) ?? 7;
  const facts = tripFacts(trip, dna);

  const skeleton = await generateStructured<{ days: GeneratedDay[] }>(
    `Lay out the shape of the best ${dayCount}-day itinerary for this group.

${facts}

Give exactly ${dayCount} days, day_index 0 to ${dayCount - 1}, in order. For each
day: a title, the locality it is based in, a one or two sentence summary, and a
warning on any day that is tight, weather-dependent, or has a long transfer.
Group the trip geographically so days flow sensibly and nobody back-tracks.
Do not list individual stops -- just the shape of each day.`,
    SKELETON_SCHEMA,
    SYSTEM,
  );

  // Fill every slot 0..n-1 so a day is never missing, even if the model skips
  // one or repeats an index.
  const frame: GeneratedDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const found = (skeleton.days ?? []).find((d) => d.day_index === i);
    frame.push(found ?? { day_index: i, title: `Day ${i + 1}`, summary: '' });
  }
  return frame;
}

/**
 * One day's stops, grounded. Its own request, so it has a full 60s budget for a
 * single day -- far more than it needs.
 */
export async function generateDayStops(
  trip: Trip,
  dna: GroupDna | null,
  day: { day_index: number; title: string; locality: string | null; summary: string | null },
): Promise<Researched<GeneratedStop[]>> {
  const dayCount = tripDays(trip) ?? 7;
  const facts = tripFacts(trip, dna);
  const where = day.locality || trip.destination;
  const month = formatMonth(trip.travel_month);
  const dietary = dna?.dietary?.length
    ? `\nHard dietary constraints to honour: ${dna.dietary.join(', ')}.`
    : '';

  const researchPrompt = `Research the best things to actually do on this day of
a trip.

Day ${day.day_index + 1} of ${dayCount}: ${day.title}, based around ${where}.
${day.summary ?? ''}

${facts}${dietary}

Find specific, named places for this day and ${where}: what is genuinely worth
doing, real visitor ratings, cost per person, how long each takes, and the best
time of day${month ? ` in ${month}` : ''}. Include how to travel between them.
Name real places, not categories.`;

  const structurePrompt = `From the research notes, give 3 to 5 stops for THIS
day only (${day.title}, ${where}), in the order they happen.

Each stop needs a specific named place, a kind (activity, meal, travel, stay or
rest), a two or three sentence summary of what you actually do there,
why_included tying it to what this group wants, a realistic duration_hours, and
a per-person cost_note where the notes support one. Include travel legs as stops
with kind "travel" and their real duration. Do not invent ratings or prices.`;

  const res = await researchThenStructure<{ stops: GeneratedStop[] }>(
    researchPrompt,
    structurePrompt,
    DAY_STOPS_SCHEMA,
    SYSTEM,
  );

  return { data: res.data.stops ?? [], sources: res.sources, grounded: res.grounded };
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
