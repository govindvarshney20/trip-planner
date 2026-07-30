import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Inclusive count of nights/days between two ISO dates. */
export function tripLengthDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function minutesToClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

/**
 * Cut runaway repetition out of model text.
 *
 * Fast models sometimes fall into a loop and emit the same short phrase dozens
 * of times ("paved over recently track surface paved over recently…"). A token
 * cap stops it filling pages, but the tail still reads as broken, so trim from
 * the point the loop starts and keep the one clean instance.
 *
 * Scans for a phrase of 1-6 words that repeats 4+ times in a row and truncates
 * there. Normal prose never triggers it; a degenerate loop always does.
 */
export function stripRepetition(text: string | undefined | null): string {
  if (!text) return '';
  const words = text.split(/\s+/);
  const MIN_REPS = 4;

  for (let start = 0; start < words.length; start++) {
    for (let p = 1; p <= 6; p++) {
      if (start + p * MIN_REPS > words.length) continue;
      const phrase = words.slice(start, start + p).join(' ').toLowerCase();
      if (!phrase.trim()) continue;

      let reps = 1;
      let j = start + p;
      while (j + p <= words.length && words.slice(j, j + p).join(' ').toLowerCase() === phrase) {
        reps++;
        j += p;
      }

      if (reps >= MIN_REPS) {
        // Keep everything up to and including the first instance of the phrase.
        const kept = words.slice(0, start + p).join(' ').replace(/[\s,;:–-]+$/, '');
        return /[.!?]$/.test(kept) ? kept : `${kept}.`;
      }
    }
  }
  return text;
}
