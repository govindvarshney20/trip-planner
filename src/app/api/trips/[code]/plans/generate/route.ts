import { db } from '@/lib/supabase';
import { fail, guard, loadTrip, ok } from '@/lib/api';
import { requireMember } from '@/lib/session';
import { generateBlueprints } from '@/lib/plans';

export const maxDuration = 60;

/** A claim older than this is assumed dead and may be taken over. */
const STALE_CLAIM_MS = 3 * 60 * 1000;

export async function POST(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return guard(async () => {
    const { code } = await ctx.params;
    const trip = await loadTrip(code);
    if (!trip) return fail('That trip does not exist', 404);

    await requireMember(trip.id);

    if (trip.plans_state === 'ready') {
      return ok({ state: 'ready', message: 'Plans already exist' });
    }

    // Atomically claim the work. Generation takes ~30s and several members may
    // open the tab at once; without this we'd run it three times and insert
    // nine plans. The conditional update is the lock -- whoever's UPDATE
    // returns a row owns the job.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { data: claimed, error: claimErr } = await db()
      .from('trips')
      .update({ plans_state: 'generating', plans_claimed_at: new Date().toISOString() })
      .eq('id', trip.id)
      .or(
        `plans_state.eq.none,plans_state.eq.failed,and(plans_state.eq.generating,plans_claimed_at.lt.${staleBefore})`,
      )
      .select()
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) {
      // Someone else got there first. Not an error -- the client polls.
      return ok({ state: 'generating', message: 'Already being generated' }, { status: 202 });
    }

    try {
      const result = await generateBlueprints(trip);
      const blueprints = result.data.plans?.slice(0, 3) ?? [];
      if (blueprints.length === 0) throw new Error('The model returned no plans');

      for (const [i, bp] of blueprints.entries()) {
        const { data: plan, error: planErr } = await db()
          .from('plans')
          .insert({
            trip_id: trip.id,
            label: bp.label,
            tagline: bp.tagline,
            tradeoff: bp.tradeoff,
            cost_estimate: bp.cost_estimate ?? null,
            intensity: bp.intensity ?? null,
            best_for: bp.best_for ?? null,
            sources: result.sources,
            grounded: result.grounded,
            seed: i * 331 + 17,
          })
          .select()
          .single();
        if (planErr) throw new Error(planErr.message);

        const days = (bp.days ?? [])
          .filter((d) => Number.isInteger(d.day_index) && d.day_index >= 0)
          .map((d) => ({
            plan_id: plan.id,
            day_index: d.day_index,
            title: d.title,
            locality: d.locality ?? null,
            summary: d.summary ?? null,
            items: d.items ?? [],
            warnings: d.warnings ?? [],
          }));

        if (days.length) {
          const { error: dayErr } = await db().from('plan_days').insert(days);
          if (dayErr) throw new Error(dayErr.message);
        }
      }

      await db().from('trips').update({ plans_state: 'ready' }).eq('id', trip.id);
      return ok({ state: 'ready', count: blueprints.length, grounded: result.grounded });
    } catch (err) {
      // Release the claim so a retry is possible rather than wedging the trip
      // in 'generating' forever.
      await db().from('trips').update({ plans_state: 'failed' }).eq('id', trip.id);
      throw err;
    }
  });
}
