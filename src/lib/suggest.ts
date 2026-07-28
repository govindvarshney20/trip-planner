import { researchThenStructure, askGrounded, type Researched } from './gemini';
import { dnaToPrompt, type GroupDna } from './dna';
import { tripLengthDays } from './utils';
import type { Citation, Trip } from './types';

/**
 * Suggestion + concierge prompting.
 *
 * The house rule everywhere in this file: the model may not invent a number.
 * Ratings, prices and durations either come from the research pass or are
 * omitted. A blank rating is fine; a fabricated 4.7 is not, because the whole
 * pitch of this product is that the group can trust what it sees.
 */

const SYSTEM = `You are Wayfare's travel research engine.

Rules you must never break:
- Never invent ratings, review counts, prices, or opening hours. If the research
  notes do not contain a figure, leave that field out entirely.
- Travel times must be realistic for the actual roads, not straight-line
  estimates. Mountain and rural routes are slow.
- Prefer specific, named places over generic categories. "Bun cha Huong Lien"
  beats "a local restaurant".
- Respect dietary constraints absolutely. They are not preferences.
- Write in clear, plain English. No brochure language, no exclamation marks.`;

export interface SuggestedIdea {
  title: string;
  category: 'sight' | 'food' | 'activity' | 'stay' | 'transport' | 'experience';
  locality?: string;
  description?: string;
  why_fits?: string;
  rating?: number;
  rating_count?: number;
  price_note?: string;
  duration_hours?: number;
  best_time?: string;
  booking_url?: string;
}

/** Gemini schema (OpenAPI 3 subset). Kept hand-written so it stays in the dialect Gemini accepts. */
const IDEAS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Specific, named place or activity' },
          category: {
            type: 'string',
            enum: ['sight', 'food', 'activity', 'stay', 'transport', 'experience'],
          },
          locality: { type: 'string', description: 'Town or region, e.g. "Ha Giang"' },
          description: { type: 'string', description: 'Two sentences maximum' },
          why_fits: {
            type: 'string',
            description: "One sentence tying it to this group's stated preferences",
          },
          rating: { type: 'number', description: 'Only if present in research notes' },
          rating_count: { type: 'integer', description: 'Only if present in research notes' },
          price_note: { type: 'string', description: 'e.g. "~₹400pp" or "free"' },
          duration_hours: { type: 'number', description: 'Realistic time on the ground' },
          best_time: { type: 'string', description: 'e.g. "early morning, before the tour buses"' },
          booking_url: { type: 'string', description: 'Only a URL seen in the research notes' },
        },
        required: ['title', 'category'],
      },
    },
  },
  required: ['ideas'],
};

function tripContext(trip: Trip, dna: GroupDna): string {
  const days = tripLengthDays(trip.start_date, trip.end_date);
  const parts = [
    `Destination: ${trip.destination}`,
    `Travellers: ${trip.party_size}`,
    days ? `Length: ${days} days (${trip.start_date} to ${trip.end_date})` : null,
    trip.budget_level ? `Trip budget level: ${trip.budget_level}` : null,
    `Currency for prices: ${trip.currency}`,
    trip.brief ? `Notes from the organiser: ${trip.brief}` : null,
    '',
    'GROUP PROFILE:',
    dnaToPrompt(dna),
  ];
  return parts.filter(Boolean).join('\n');
}

/** Generate a batch of shortlist candidates tailored to the group. */
export async function suggestIdeas(
  trip: Trip,
  dna: GroupDna,
  opts: { count?: number; focus?: string; exclude?: string[] } = {},
): Promise<Researched<{ ideas: SuggestedIdea[] }>> {
  const count = opts.count ?? 8;
  const ctx = tripContext(trip, dna);

  const exclusion = opts.exclude?.length
    ? `\n\nAlready on their board, do not repeat: ${opts.exclude.join(', ')}.`
    : '';

  const focus = opts.focus ? `\n\nFocus this batch on: ${opts.focus}.` : '';

  const researchPrompt = `Research the best things to do for this specific group of travellers.

${ctx}${focus}${exclusion}

Find ${count} specific, named, currently-operating places or experiences. For each, find:
- what it actually is and why this group in particular would like it
- current visitor ratings and roughly how many reviews, if reported anywhere
- realistic time needed on the ground
- typical cost per person
- the best time of day or conditions to go
- where to book it, if booking is needed

Prioritise places that suit the group's stated pace, budget and interests.
Cover the minority interests too -- at least one option for each.
If the trip has a fixed length, do not suggest more than the group could
plausibly do.`;

  const structurePrompt = `Convert the research notes below into structured data for ${count} ideas.
Omit any numeric field the notes do not support. Do not guess.`;

  return researchThenStructure<{ ideas: SuggestedIdea[] }>(
    researchPrompt,
    structurePrompt,
    IDEAS_SCHEMA,
    SYSTEM,
  );
}

export interface ConciergeAnswer {
  text: string;
  sources: Citation[];
  grounded: boolean;
}

/**
 * Trip-aware Q&A. The concierge sees the destination, the dates, the group
 * profile and what is already on the board, so "is this too much for one day?"
 * is answerable.
 */
export async function askConcierge(
  trip: Trip,
  dna: GroupDna,
  question: string,
  boardTitles: string[],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<ConciergeAnswer> {
  const ctx = tripContext(trip, dna);
  const board = boardTitles.length
    ? `\n\nAlready shortlisted: ${boardTitles.join(', ')}.`
    : '\n\nNothing shortlisted yet.';

  const recent = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Traveller' : 'You'}: ${m.content}`)
    .join('\n');
  const priorTurns = recent ? `\n\nEarlier in this conversation:\n${recent}` : '';

  const prompt = `${ctx}${board}${priorTurns}

The group asks: "${question}"

Answer for this specific trip, not in general. Be concrete: name places, give
real travel times, quote prices in ${trip.currency} where you can. If the answer
depends on something they haven't decided yet, say what that is. If something
they are planning looks unrealistic, say so plainly and tell them what to do
instead. Keep it under 200 words unless the question genuinely needs more.`;

  const res = await askGrounded(prompt, SYSTEM);
  return { text: res.text, sources: res.sources, grounded: res.grounded };
}
