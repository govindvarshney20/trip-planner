import { GoogleGenAI } from '@google/genai';
import type { Citation } from './types';

/**
 * Gemini 3.6 Flash — the strongest fast model available on our key, with a 1M
 * token context window and thinking enabled. Verified against the live
 * models endpoint; do not swap without re-checking availability.
 */
export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/* -------------------------------------------------------------------------
 * Grounding availability
 *
 * Google Search grounding needs a billed Gemini project. On the free tier it
 * returns 429 RESOURCE_EXHAUSTED on every call. Rather than failing the user's
 * request, we detect that once, remember it, and degrade to ungrounded
 * generation (surfaced in the UI as an "unverified" badge).
 *
 * The flag is re-probed after a cooldown so that enabling billing lights
 * grounding back up without a redeploy.
 * ---------------------------------------------------------------------- */

const GROUNDING_RECHECK_MS = 10 * 60 * 1000;
let groundingBlockedUntil = 0;

export function groundingLikelyAvailable(): boolean {
  if (process.env.GEMINI_DISABLE_GROUNDING === '1') return false;
  return Date.now() >= groundingBlockedUntil;
}

function isQuotaError(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err);
  return s.includes('429') || s.includes('RESOURCE_EXHAUSTED') || s.includes('quota');
}

function markGroundingBlocked() {
  groundingBlockedUntil = Date.now() + GROUNDING_RECHECK_MS;
}

/** Pull web citations out of a response's grounding metadata. */
function extractCitations(res: unknown): Citation[] {
  const chunks =
    (res as { candidates?: { groundingMetadata?: { groundingChunks?: unknown[] } }[] })
      ?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (!web?.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    out.push({ uri: web.uri, title: web.title || new URL(web.uri).hostname });
  }
  return out;
}

export interface GroundedText {
  text: string;
  sources: Citation[];
  grounded: boolean;
}

/**
 * Free-text answer, grounded in Google Search when the key allows it.
 * Falls back to the model's own knowledge, flagged `grounded: false`.
 */
export async function askGrounded(
  prompt: string,
  systemInstruction?: string,
): Promise<GroundedText> {
  if (groundingLikelyAvailable()) {
    try {
      const res = await ai().models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          ...(systemInstruction ? { systemInstruction } : {}),
        },
      });
      return { text: res.text ?? '', sources: extractCitations(res), grounded: true };
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      markGroundingBlocked();
      // fall through to ungrounded
    }
  }

  const res = await ai().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: systemInstruction ? { systemInstruction } : {},
  });
  return { text: res.text ?? '', sources: [], grounded: false };
}

/**
 * Structured JSON output against a Gemini schema.
 *
 * Note: Gemini rejects `responseSchema` combined with the googleSearch tool, so
 * this call is always ungrounded. To get *grounded* structured data, use
 * `researchThenStructure`, which does the two passes explicitly.
 */
export async function generateStructured<T>(
  prompt: string,
  responseSchema: Record<string, unknown>,
  systemInstruction?: string,
  opts: { maxOutputTokens?: number } = {},
): Promise<T> {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      // A generous ceiling. It exists only as a backstop against a model that
      // loops forever; it must NOT be so low it truncates a legitimate JSON
      // body. Gemini's thinking tokens are spent from this same budget, so a
      // tight cap can leave too little for the actual answer and cut the JSON
      // mid-object -- which then fails to parse. The repetition guard, not this
      // number, is what trims a degenerate loop.
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(systemInstruction ? { systemInstruction } : {}),
    },
  });

  return coerceJson<T>(res.text ?? '');
}

/**
 * Parse model JSON, surviving the two ways it goes wrong: markdown fences
 * around it, and truncation (the response cut off mid-structure when the token
 * budget ran out). A truncated body is repaired by closing whatever strings and
 * brackets were left open, which recovers everything up to the cut.
 */
export function coerceJson<T>(raw: string): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    // fall through to repair
  }

  try {
    return JSON.parse(repairTruncatedJson(stripped)) as T;
  } catch {
    throw new Error('The model returned an unreadable response. Please try again.');
  }
}

/** Close strings and brackets left open by a truncated response. */
function repairTruncatedJson(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }

  let out = s;
  if (inStr) out += '"'; // close a dangling string
  // Drop a trailing comma or a half-written key/value before closing.
  out = out.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  // Finally, remove any comma left directly before a closing bracket, e.g. the
  // trailing comma in {"a":1,} once the brace is back in place.
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

export interface Researched<T> {
  data: T;
  sources: Citation[];
  grounded: boolean;
}

/**
 * Two-pass grounded structured generation.
 *
 *   pass 1 — research the question with Google Search, collecting citations
 *   pass 2 — reshape those findings into strict JSON
 *
 * Two passes is not a workaround for convenience; the API genuinely refuses
 * tools and responseSchema together. The upside is that pass 2 sees real
 * retrieved text rather than the model's recollection, so figures like ratings
 * and prices trace back to a source we can show the user.
 */
export async function researchThenStructure<T>(
  researchPrompt: string,
  structurePrompt: string,
  responseSchema: Record<string, unknown>,
  systemInstruction?: string,
  opts: { maxOutputTokens?: number } = {},
): Promise<Researched<T>> {
  const research = await askGrounded(researchPrompt, systemInstruction);

  const data = await generateStructured<T>(
    `${structurePrompt}\n\n--- RESEARCH NOTES ---\n${research.text}`,
    responseSchema,
    systemInstruction,
    opts,
  );

  return { data, sources: research.sources, grounded: research.grounded };
}
