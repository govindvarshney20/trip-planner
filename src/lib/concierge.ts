import { askGrounded } from './gemini';
import { dnaToPrompt, type GroupDna } from './dna';
import { formatMonth, tripDays } from './trip-copy';
import type { Citation, ItineraryDay, Trip } from './types';

/**
 * The AI concierge.
 *
 * Its whole value is that it knows *this* trip: the destination, the length,
 * the group's preferences, and the actual plan they are looking at. A generic
 * travel chatbot cannot answer "is day 4 too much?".
 */

const SYSTEM = `You are Wayfare's travel concierge, answering for one specific
group's trip.

Rules:
- Never invent a rating, price, or opening time. Say you do not know instead.
- Travel times must be realistic for the actual roads. Mountain and rural
  routes are slow.
- If what they are planning is unrealistic, say so plainly and say what to do
  instead. That is more useful than agreeing.
- Respect dietary constraints absolutely.
- Plain English. No brochure language, no exclamation marks.`;

export interface ConciergeAnswer {
  text: string;
  sources: Citation[];
  grounded: boolean;
}

/** Compact rendering of the plan, so the model can reason about the real days. */
function itineraryToPrompt(days: ItineraryDay[]): string {
  if (days.length === 0) return 'No itinerary built yet.';

  return days
    .map((d) => {
      const stops = d.stops
        .map((s) => {
          const bits = [s.title];
          if (s.kind === 'travel') bits.push('(travel)');
          if (s.duration_hours) bits.push(`${s.duration_hours}h`);
          return bits.join(' ');
        })
        .join('; ');

      const load = d.travelHours > 0 ? ` [${d.travelHours}h travel]` : '';
      return `Day ${d.day_index + 1} — ${d.title}${load}: ${stops || 'nothing planned'}`;
    })
    .join('\n');
}

export async function askConcierge(
  trip: Trip,
  dna: GroupDna,
  question: string,
  days: ItineraryDay[],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<ConciergeAnswer> {
  const dayCount = tripDays(trip);
  const when =
    trip.start_date && trip.end_date
      ? `Dates: ${trip.start_date} to ${trip.end_date}`
      : trip.travel_month
        ? `Travelling in: ${formatMonth(trip.travel_month)} (exact dates not fixed)`
        : null;

  const context = [
    `Destination: ${trip.destination}`,
    `Travellers: ${trip.party_size}`,
    dayCount ? `Length: ${dayCount} days` : null,
    when,
    trip.budget_level ? `Budget level: ${trip.budget_level}` : null,
    `Currency: ${trip.currency}`,
    trip.brief ? `What they told us: ${trip.brief}` : null,
    dna.respondents > 0 ? `\nGROUP PREFERENCES:\n${dnaToPrompt(dna)}` : null,
    `\nTHEIR CURRENT PLAN:\n${itineraryToPrompt(days)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const recent = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Traveller' : 'You'}: ${m.content}`)
    .join('\n');

  const prompt = `${context}${recent ? `\n\nEarlier in this conversation:\n${recent}` : ''}

The group asks: "${question}"

Answer for this specific trip, referring to their actual plan where it is
relevant. Be concrete: name places, give real travel times, quote prices in
${trip.currency} where you can. If the answer depends on something they have not
decided yet, say what that is. Keep it under 200 words unless the question
genuinely needs more.`;

  const res = await askGrounded(prompt, SYSTEM);
  return { text: res.text, sources: res.sources, grounded: res.grounded };
}
