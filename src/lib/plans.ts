import { researchThenStructure, type Researched } from './gemini';
import { formatMonth, tripDays } from './trip-copy';
import type { Trip } from './types';

/**
 * Blueprint generation.
 *
 * Deliberately takes ONLY the trip's own facts -- destination, dates, party
 * size, budget, the creator's brief. No member preferences. That is what makes
 * the starting point neutral: whoever fills their form first does not get to
 * shape the options everyone else reacts to.
 */

const SYSTEM = `You are Wayfare's trip architect. You design complete, realistic
multi-day trips.

Hard rules:
- Every plan must be physically possible. Real road times on real roads. Rural
  and mountain routes are slow. Account for the hours a transfer actually eats.
- Never invent a price or a rating. Omit what the research does not support.
- Each plan must make ONE clear choice about what kind of trip it is, and must
  state plainly what it gives up to do that. A plan that sacrifices nothing is
  not a plan.
- The options must be genuinely different trips, not the same trip reordered.
  Someone should be able to prefer one over another for real reasons.
- No strawmen. Every option must be one a sensible traveller could pick.
- Plain English. No brochure language, no exclamation marks.`;

export interface BlueprintDay {
  day_index: number;
  title: string;
  locality?: string;
  summary?: string;
  items?: {
    title: string;
    kind?: 'activity' | 'meal' | 'travel' | 'rest';
    duration_hours?: number;
    note?: string;
  }[];
  warnings?: { level: 'warn' | 'clash'; message: string }[];
}

export interface Blueprint {
  label: string;
  tagline: string;
  tradeoff: string;
  cost_estimate?: string;
  intensity?: 'low' | 'moderate' | 'high';
  best_for?: string;
  days: BlueprintDay[];
}

const PLANS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short evocative name, 2-4 words' },
          tagline: { type: 'string', description: 'One sentence on what this trip is' },
          tradeoff: {
            type: 'string',
            description: 'What this plan deliberately gives up, and why that buys something',
          },
          cost_estimate: {
            type: 'string',
            description: 'Rough per-person total excluding flights, in the trip currency',
          },
          intensity: { type: 'string', enum: ['low', 'moderate', 'high'] },
          best_for: { type: 'string', description: 'The kind of traveller this suits' },
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day_index: { type: 'integer', description: '0-based day number' },
                title: { type: 'string', description: 'e.g. "Hanoi to Ha Giang"' },
                locality: { type: 'string' },
                summary: { type: 'string', description: 'One or two sentences' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      kind: { type: 'string', enum: ['activity', 'meal', 'travel', 'rest'] },
                      duration_hours: { type: 'number' },
                      note: { type: 'string' },
                    },
                    required: ['title'],
                  },
                },
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
              required: ['day_index', 'title'],
            },
          },
        },
        required: ['label', 'tagline', 'tradeoff', 'days'],
      },
    },
  },
  required: ['plans'],
};

export async function generateBlueprints(
  trip: Trip,
): Promise<Researched<{ plans: Blueprint[] }>> {
  const dayCount = tripDays(trip) ?? 7;
  const when =
    trip.start_date && trip.end_date
      ? `Dates: ${trip.start_date} to ${trip.end_date}`
      : trip.travel_month
        ? `Travelling in: ${formatMonth(trip.travel_month)} (exact dates not fixed yet)`
        : null;

  const facts = [
    `Destination: ${trip.destination}`,
    `Travellers: ${trip.party_size}`,
    `Length: ${dayCount} days on the ground`,
    when,
    trip.budget_level ? `Budget level: ${trip.budget_level}` : null,
    `Quote prices in: ${trip.currency}`,
    trip.brief ? `Notes from the organiser: ${trip.brief}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const researchPrompt = `Research everything needed to design three different
${dayCount}-day trips for this group.

${facts}

Find out:
- the genuinely worthwhile places in this destination, and how long each needs
- real travel times between them, by the transport people actually use
- what the weather and conditions will be like on these specific dates
- what things cost per person
- what is commonly overdone or rushed by visitors, and what gets skipped that
  shouldn't
- anything time-sensitive on these dates: closures, festivals, seasonal access

Be specific and name places. Note where two places are far enough apart that
combining them costs most of a day.`;

  const structurePrompt = `Using the research notes, design exactly THREE distinct
${dayCount}-day plans for this trip.

${facts}

The three plans must differ in kind, not detail. Good axes to differ on:
- covering more ground vs going deeper in fewer places
- higher intensity vs more recovery time
- the well-known highlights vs the quieter alternative

For each plan give every day from day_index 0 to ${dayCount - 1}, with 2-4 items
per day. Include travel legs as items with kind "travel" and their real
duration -- a 6 hour transfer must appear as 6 hours, not be glossed over.

Add a warning on any day that is tight, weather-dependent, or involves a long
transfer. Being honest about a hard day is more useful than hiding it.

State each plan's tradeoff plainly. "Skips Ninh Binh entirely so Ha Giang gets
four unhurried days" is the shape to aim for.`;

  return researchThenStructure<{ plans: Blueprint[] }>(
    researchPrompt,
    structurePrompt,
    PLANS_SCHEMA,
    SYSTEM,
  );
}

/* -------------------------------------------------------------------------
 * Ranked-choice scoring
 *
 * Borda count: with three plans a first choice scores 3, second 2, third 1.
 * Unlike "most first-place votes", this notices the plan everyone can live
 * with -- which for a group trip is usually the right answer.
 * ---------------------------------------------------------------------- */

export interface PlanTally {
  planId: string;
  points: number;
  firsts: number;
  /** True when no member ranked it last. */
  noVetoes: boolean;
  voters: number;
}

export function tallyVotes(
  planIds: string[],
  votes: { plan_id: string; member_id: string; rank: number }[],
): PlanTally[] {
  const n = planIds.length;
  const byPlan = new Map<string, PlanTally>(
    planIds.map((id) => [id, { planId: id, points: 0, firsts: 0, noVetoes: true, voters: 0 }]),
  );

  for (const v of votes) {
    const t = byPlan.get(v.plan_id);
    if (!t) continue;
    t.points += n - v.rank + 1;
    t.voters += 1;
    if (v.rank === 1) t.firsts += 1;
    if (v.rank === n) t.noVetoes = false;
  }

  // Tiebreak order matters as much as the count. "Nobody ranked it last" comes
  // before "most first choices": on a genuine tie between a divisive plan and
  // one everybody can live with, the group trip wants the latter. Breaking ties
  // on firsts would have quietly favoured the polarising option -- the exact
  // outcome ranked voting is meant to avoid.
  return [...byPlan.values()].sort(
    (a, b) =>
      b.points - a.points ||
      Number(b.noVetoes) - Number(a.noVetoes) ||
      b.firsts - a.firsts ||
      a.planId.localeCompare(b.planId),
  );
}

/**
 * Per-member display order.
 *
 * Everyone sees the same three plans in a different order, so "first on the
 * page" does not quietly become "most voted for". Derived from the member id so
 * it is stable across reloads -- a list that reshuffles on every render is
 * worse than a biased one.
 */
export function orderForMember<T extends { id: string; seed: number }>(
  plans: T[],
  memberId: string,
): T[] {
  // Hash each (member, plan) pair and sort by the result -- a real per-member
  // permutation.
  //
  // An earlier version offset a shared hash by each plan's seed, which mostly
  // preserved one global order: ids differing in their last characters produced
  // near-identical hashes, so every member saw the same list and the position
  // bias this exists to prevent went unprevented.
  return [...plans]
    .map((plan) => ({ plan, key: fnv1a(`${memberId}:${plan.id}`) }))
    .sort((a, b) => a.key - b.key || a.plan.seed - b.plan.seed)
    .map((x) => x.plan);
}

/**
 * FNV-1a plus a murmur3 finalizer.
 *
 * The finalizer is not optional here. Plain FNV-1a barely diffuses a difference
 * in the final character, and our inputs end in ids that may differ by one
 * character -- which skewed one plan into first place on 52% of draws instead
 * of 33%. The avalanche step spreads low-bit differences across all 32 bits.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
