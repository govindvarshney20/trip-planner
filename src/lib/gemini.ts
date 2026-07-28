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
): Promise<T> {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      ...(systemInstruction ? { systemInstruction } : {}),
    },
  });

  const raw = res.text ?? '';
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Defensive: strip markdown fences if the model wraps its JSON.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(cleaned) as T;
  }
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
): Promise<Researched<T>> {
  const research = await askGrounded(researchPrompt, systemInstruction);

  const data = await generateStructured<T>(
    `${structurePrompt}\n\n--- RESEARCH NOTES ---\n${research.text}`,
    responseSchema,
    systemInstruction,
  );

  return { data, sources: research.sources, grounded: research.grounded };
}
