import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service role key.
 *
 * Every table has RLS enabled with no policies, so this is the *only* way the
 * app reads or writes trip data. Never import this from a client component --
 * the service role key bypasses RLS entirely.
 */

let admin: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (admin) return admin;

  const url = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/**
 * Accepts either the bare project URL or the REST endpoint and returns the
 * origin the client library expects. The Supabase dashboard shows the REST URL
 * in some places, and pasting that in is an easy and confusing mistake.
 */
export function normalizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return undefined;
  }
}
