import type { Trip } from './types';
import { tripLengthDays } from './utils';

/**
 * Trip length, from whichever field is populated.
 *
 * Since the create flow switched to month + day count, exact dates are usually
 * absent. Anything reading `tripLengthDays(start, end)` directly now gets null
 * for most trips -- which silently became "assume 7 days" inside the AI
 * prompts. Every caller should go through here instead.
 */
export function tripDays(
  trip: Pick<Trip, 'day_count' | 'start_date' | 'end_date'>,
): number | null {
  if (trip.day_count && trip.day_count > 0) return trip.day_count;
  return tripLengthDays(trip.start_date, trip.end_date);
}

/**
 * Copy and formatting helpers shared by the create flow and the trip header.
 */

/** Presets for "anything we should know" -- a blank textarea yields nothing. */
export const CONTEXT_CHIPS = [
  { id: 'first-intl', label: 'First international trip', text: 'This is our first international trip.' },
  { id: 'tight-budget', label: 'Budget is tight', text: 'We are watching what we spend.' },
  { id: 'active', label: 'We want to be active', text: 'We want treks and physical days, not just sightseeing.' },
  { id: 'no-long-bus', label: 'No long bus journeys', text: 'We would rather avoid long overnight bus rides.' },
  { id: 'veg', label: 'Vegetarian food matters', text: 'Some of us are vegetarian, so food options matter.' },
  { id: 'nightlife', label: 'Nightlife is a priority', text: 'We want good nights out, not just early mornings.' },
  { id: 'photos', label: 'Photography is a priority', text: 'We care about photogenic spots and good light.' },
  { id: 'slow', label: 'We want it slow', text: 'We would rather do less and enjoy it than rush around.' },
] as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The next 18 months as { value: 'YYYY-MM', label: 'October 2026' }.
 *
 * Takes `now` as an argument rather than reading the clock, so the caller
 * decides the reference point and render stays pure.
 */
export function monthOptions(now: Date): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const y = now.getFullYear();
  const m = now.getMonth();
  for (let i = 0; i < 18; i++) {
    const d = new Date(y, m + i, 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    out.push({ value: `${d.getFullYear()}-${mm}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

/** '2026-10' -> 'October 2026'. Returns the input unchanged if unparseable. */
export function formatMonth(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  const idx = Number(m[2]) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${m[1]}` : value;
}

/**
 * Trip name is optional in the form, so derive a decent one.
 * "Hanoi, Ha Giang, Ninh Binh" -> "Hanoi + 2 more · 9 days"
 */
export function deriveTripName(destination: string, dayCount: number): string {
  const parts = destination
    .split(/[,;]|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);

  const place =
    parts.length > 1 ? `${parts[0]} + ${parts.length - 1} more` : parts[0] || destination.trim();

  return `${place} · ${dayCount} ${dayCount === 1 ? 'day' : 'days'}`;
}

/** Human summary of when and how long, from whichever fields are populated. */
export function tripWhen(trip: Pick<Trip, 'start_date' | 'end_date' | 'travel_month' | 'day_count'>): string {
  const days = trip.day_count;
  const length = days ? `${days} ${days === 1 ? 'day' : 'days'}` : null;

  if (trip.start_date && trip.end_date) {
    return [length, `${trip.start_date} → ${trip.end_date}`].filter(Boolean).join(' · ');
  }
  return [length, formatMonth(trip.travel_month)].filter(Boolean).join(' · ');
}

/** Currency guess from the destination, so the form doesn't have to ask. */
export function guessCurrency(destination: string): string {
  const d = destination.toLowerCase();
  const table: [RegExp, string][] = [
    [/vietnam|hanoi|saigon|ha giang|ninh binh|cat ba|da nang|hoi an/, 'VND'],
    [/thailand|bangkok|phuket|chiang mai|krabi/, 'THB'],
    [/indonesia|bali|jakarta|lombok/, 'IDR'],
    [/japan|tokyo|osaka|kyoto/, 'JPY'],
    [/singapore/, 'SGD'],
    [/malaysia|kuala lumpur|langkawi|penang/, 'MYR'],
    [/dubai|abu dhabi|\buae\b|emirates/, 'AED'],
    [/sri lanka|colombo|kandy|ella/, 'LKR'],
    [/nepal|kathmandu|pokhara/, 'NPR'],
    [/\buk\b|london|scotland|england/, 'GBP'],
    [/france|paris|italy|rome|spain|germany|berlin|portugal|lisbon|netherlands|amsterdam|greece/, 'EUR'],
    [/\busa\b|united states|new york|california|vegas/, 'USD'],
    [/australia|sydney|melbourne/, 'AUD'],
    [/india|goa|kerala|ladakh|rajasthan|himachal|manali|jaipur/, 'INR'],
  ];
  for (const [re, code] of table) if (re.test(d)) return code;
  // Default to the home currency of who we're building this for first.
  return 'INR';
}
