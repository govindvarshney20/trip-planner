import type { BudgetLevel, Intensity, Member, Pace, Preferences, WakeTime } from './types';
import { INTERESTS } from './types';

/**
 * Group DNA
 *
 * Turns individual preference forms into a picture of the group: what everyone
 * agrees on, what only some people want, and -- most usefully -- where the
 * group is quietly in conflict.
 *
 * The point is not the number. The point is surfacing "3 of you want nightlife
 * and 3 of you want 6am starts" in week one instead of on day three of the
 * trip.
 */

export type ConflictSeverity = 'info' | 'warn' | 'clash';

export interface Conflict {
  severity: ConflictSeverity;
  title: string;
  detail: string;
  /** Concrete way out, phrased as something the group can actually do. */
  suggestion: string;
}

export interface InterestSplit {
  interest: string;
  count: number;
  members: string[];
  /** everyone / most / some / one */
  band: 'everyone' | 'most' | 'some' | 'one';
}

export interface GroupDna {
  respondents: number;
  totalMembers: number;
  /** 0-100. High means the group wants broadly the same trip. */
  consensus: number;
  shared: InterestSplit[];
  split: InterestSplit[];
  conflicts: Conflict[];
  /** Dietary needs are constraints, not preferences: the union must be honoured. */
  dietary: string[];
  nonNegotiables: { member: string; text: string }[];
  /** Majority answers, used to seed AI suggestions. */
  dominant: {
    pace: Pace | null;
    budget: BudgetLevel | null;
    wake: WakeTime | null;
    intensity: Intensity | null;
  };
}

const PACE_RANK: Record<Pace, number> = { chill: 0, balanced: 1, packed: 2 };
const BUDGET_RANK: Record<BudgetLevel, number> = {
  shoestring: 0,
  value: 1,
  comfort: 2,
  luxury: 3,
};
const WAKE_RANK: Record<WakeTime, number> = { early: 0, mid: 1, late: 2 };

function modeOf<T extends string>(values: (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Overlap coefficient: |A ∩ B| / min(|A|, |B|).
 *
 * Deliberately not Jaccard. Jaccard punishes the person who ticks eight
 * interests against the person who ticks two, even when the smaller set sits
 * entirely inside the larger one -- which is agreement, not disagreement.
 */
function overlap(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

function bandFor(count: number, total: number): InterestSplit['band'] {
  if (count === total) return 'everyone';
  if (count === 1) return 'one';
  if (count / total >= 0.6) return 'most';
  return 'some';
}

function nameOf(members: Member[], id: string): string {
  return members.find((m) => m.id === id)?.display_name ?? 'Someone';
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Verb agreement for a name list. These strings are read by the actual people
 * named in them, so "Aditi want a slow trip" undercuts the whole thing.
 */
function agree(names: string[], singular: string, plural: string): string {
  return names.length === 1 ? singular : plural;
}

export function computeGroupDna(members: Member[], prefs: Preferences[]): GroupDna {
  const active = members.filter((m) => !m.removed);
  const answered = prefs.filter((p) => active.some((m) => m.id === p.member_id));
  const n = answered.length;

  const empty: GroupDna = {
    respondents: 0,
    totalMembers: active.length,
    consensus: 0,
    shared: [],
    split: [],
    conflicts: [],
    dietary: [],
    nonNegotiables: [],
    dominant: { pace: null, budget: null, wake: null, intensity: null },
  };
  if (n === 0) return empty;

  /* ---- interest bands ---------------------------------------------------- */
  const splits: InterestSplit[] = [];
  for (const interest of INTERESTS) {
    const who = answered.filter((p) => p.interests.includes(interest));
    if (who.length === 0) continue;
    splits.push({
      interest,
      count: who.length,
      members: who.map((p) => nameOf(active, p.member_id)),
      band: bandFor(who.length, n),
    });
  }
  splits.sort((a, b) => b.count - a.count || a.interest.localeCompare(b.interest));

  const shared = splits.filter((s) => s.band === 'everyone' || s.band === 'most');
  const split = splits.filter((s) => s.band === 'some' || s.band === 'one');

  /* ---- consensus --------------------------------------------------------- */
  // A weighted blend of two things: how much the group's interests overlap, and
  // how closely they agree on the logistics that actually wreck days (pace,
  // budget, wake time).
  //
  // This used to subtract a penalty from the interest score, which drove real
  // groups to a flat 0 -- telling four friends who all picked "nature" that
  // they have nothing in common. A blend degrades gracefully instead: a
  // genuinely divergent group scores low, but never zero while some overlap
  // exists.
  let pairSum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairSum += overlap(answered[i].interests, answered[j].interests);
      pairs++;
    }
  }
  const interestAgreement = pairs === 0 ? 1 : pairSum / pairs;

  const spread = <T extends string>(vals: (T | null)[], rank: Record<T, number>): number => {
    const nums = vals.filter((v): v is T => !!v).map((v) => rank[v]);
    if (nums.length < 2) return 0;
    return (Math.max(...nums) - Math.min(...nums)) / Math.max(1, Object.keys(rank).length - 1);
  };

  const paceSpread = spread<Pace>(answered.map((p) => p.pace), PACE_RANK);
  const budgetSpread = spread<BudgetLevel>(answered.map((p) => p.budget_level), BUDGET_RANK);
  const wakeSpread = spread<WakeTime>(answered.map((p) => p.wake_time), WAKE_RANK);

  // Pace and budget cause more friction than body clocks, so weight them up.
  const logisticsAgreement =
    1 - (paceSpread * 0.4 + budgetSpread * 0.4 + wakeSpread * 0.2);

  const blended = 0.6 * interestAgreement + 0.4 * logisticsAgreement;
  const consensus = Math.round(Math.max(0, Math.min(1, blended)) * 100);

  /* ---- conflicts --------------------------------------------------------- */
  const conflicts: Conflict[] = [];

  const paces = answered.filter((p) => p.pace);
  const chill = paces.filter((p) => p.pace === 'chill');
  const packed = paces.filter((p) => p.pace === 'packed');
  if (chill.length && packed.length) {
    const chillNames = chill.map((p) => nameOf(active, p.member_id));
    const packedNames = packed.map((p) => nameOf(active, p.member_id));
    conflicts.push({
      severity: 'clash',
      title: 'Split on how packed the days should be',
      detail: `${listNames(chillNames)} ${agree(chillNames, 'wants', 'want')} a slow trip, while ${listNames(
        packedNames,
      )} ${agree(packedNames, 'wants', 'want')} to fit a lot in.`,
      suggestion:
        'Anchor each day with one thing everyone does together, then leave the afternoon optional. Nobody has to opt out of the whole day.',
    });
  }

  const budgets = answered.filter((p) => p.budget_level);
  const low = budgets.filter((p) => p.budget_level === 'shoestring');
  const high = budgets.filter((p) => p.budget_level === 'luxury');
  if (low.length && high.length) {
    conflicts.push({
      severity: 'clash',
      title: 'Budgets are far apart',
      detail: `${listNames(low.map((p) => nameOf(active, p.member_id)))} picked shoestring; ${listNames(
        high.map((p) => nameOf(active, p.member_id)),
      )} picked luxury. Left unsaid, this turns into friction at every booking.`,
      suggestion:
        'Agree a shared baseline for rooms and transport, and let anyone upgrade privately. Decide it now, once, rather than per booking.',
    });
  }

  const early = answered.filter((p) => p.wake_time === 'early');
  const late = answered.filter((p) => p.wake_time === 'late');
  const nightlifeFans = answered.filter((p) => p.interests.includes('nightlife'));
  if (early.length && nightlifeFans.length && early.length + nightlifeFans.length > n) {
    conflicts.push({
      severity: 'warn',
      title: 'Early starts and late nights want the same hours',
      detail: `${early.length} of you plan 6am starts and ${nightlifeFans.length} want nightlife. Something has to give on at least some days.`,
      suggestion:
        'Put the sunrise activities and the big nights on different days rather than fighting over each one.',
    });
  } else if (early.length && late.length) {
    const earlyNames = early.map((p) => nameOf(active, p.member_id));
    const lateNames = late.map((p) => nameOf(active, p.member_id));
    conflicts.push({
      severity: 'info',
      title: 'Different body clocks',
      detail: `${listNames(earlyNames)} ${agree(earlyNames, 'is an early riser', 'are early risers')}; ${listNames(
        lateNames,
      )} ${agree(lateNames, 'is not', 'are not')}.`,
      suggestion: 'Set a realistic daily departure time now so nobody is waiting in a lobby.',
    });
  }

  const intensities = answered.filter((p) => p.intensity);
  const lowInt = intensities.filter((p) => p.intensity === 'low');
  const highInt = intensities.filter((p) => p.intensity === 'high');
  if (lowInt.length && highInt.length) {
    const highNames = highInt.map((p) => nameOf(active, p.member_id));
    const lowNames = lowInt.map((p) => nameOf(active, p.member_id));
    conflicts.push({
      severity: 'warn',
      title: 'Mismatched appetite for physical days',
      detail: `${listNames(highNames)} ${agree(highNames, 'is', 'are')} up for hard treks; ${listNames(
        lowNames,
      )} would rather not.`,
      suggestion:
        'Look for spots where the hard and easy versions end in the same place, so the group still eats together.',
    });
  }

  const dietary = [...new Set(answered.flatMap((p) => p.dietary))].sort();
  if (dietary.length) {
    conflicts.push({
      severity: 'info',
      title: 'Dietary needs to design around',
      detail: `The group needs ${listNames(dietary)} options. These are constraints, not preferences.`,
      suggestion:
        'Every restaurant we suggest gets checked against this list before it reaches your board.',
    });
  }

  if (n < active.length) {
    conflicts.push({
      severity: 'info',
      title: `${active.length - n} of you haven't filled this in yet`,
      detail:
        'Suggestions get noticeably better once everyone has. It takes about a minute.',
      suggestion: 'Nudge them with the trip link.',
    });
  }

  const nonNegotiables = answered
    .filter((p) => p.non_negotiables?.trim())
    .map((p) => ({ member: nameOf(active, p.member_id), text: p.non_negotiables!.trim() }));

  return {
    respondents: n,
    totalMembers: active.length,
    consensus,
    shared,
    split,
    conflicts,
    dietary,
    nonNegotiables,
    dominant: {
      pace: modeOf(answered.map((p) => p.pace)),
      budget: modeOf(answered.map((p) => p.budget_level)),
      wake: modeOf(answered.map((p) => p.wake_time)),
      intensity: modeOf(answered.map((p) => p.intensity)),
    },
  };
}

/**
 * A bare number invites the wrong reading -- "42" looks like a failing grade.
 * The label says what it actually means for the trip.
 */
export function consensusLabel(score: number): string {
  if (score >= 75) return 'You want the same trip';
  if (score >= 55) return 'Broadly aligned';
  if (score >= 35) return 'Some real differences';
  return 'You want quite different trips';
}

/** Compact natural-language brief handed to Gemini as trip context. */
export function dnaToPrompt(dna: GroupDna): string {
  if (dna.respondents === 0) return 'No preferences collected yet.';
  const lines: string[] = [];
  lines.push(`${dna.respondents} of ${dna.totalMembers} travellers have shared preferences.`);
  if (dna.dominant.pace) lines.push(`Preferred pace: ${dna.dominant.pace}.`);
  if (dna.dominant.budget) lines.push(`Budget level: ${dna.dominant.budget}.`);
  if (dna.dominant.wake) lines.push(`Typical start: ${dna.dominant.wake} riser.`);
  if (dna.dominant.intensity) lines.push(`Physical intensity: ${dna.dominant.intensity}.`);
  if (dna.shared.length) {
    lines.push(`Shared interests: ${dna.shared.map((s) => s.interest).join(', ')}.`);
  }
  if (dna.split.length) {
    lines.push(
      `Minority interests worth covering at least once: ${dna.split
        .map((s) => `${s.interest} (${s.members.join(', ')})`)
        .join('; ')}.`,
    );
  }
  if (dna.dietary.length) {
    lines.push(`HARD dietary constraints that must be respected: ${dna.dietary.join(', ')}.`);
  }
  if (dna.nonNegotiables.length) {
    lines.push(
      `Non-negotiables: ${dna.nonNegotiables.map((x) => `${x.member} — "${x.text}"`).join('; ')}.`,
    );
  }
  if (dna.conflicts.some((c) => c.severity === 'clash')) {
    lines.push(
      `Known tensions to plan around: ${dna.conflicts
        .filter((c) => c.severity === 'clash')
        .map((c) => c.title)
        .join('; ')}.`,
    );
  }
  return lines.join('\n');
}
