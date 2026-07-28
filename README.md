# 🧭 Wayfare

Group trip planning that actually reaches a decision.

Group trips die in three places: ideas scatter across a chat, nobody wants to be
the one who decides, and the plan lives in one person's head. Wayfare handles all
three — and refuses to hand you an itinerary that can't physically be done.

---

## What works today

| Area | State |
|---|---|
| Create a trip, invite by link or spoken code | ✅ |
| Join with no signup — name and an avatar | ✅ |
| Preference intake + **Group DNA** (agreement, splits, conflicts) | ✅ |
| AI shortlist suggestions, grounded in Google Search with citations | ✅ |
| React 🔥 / 👍 / 😐 / ❌, auto-ranked board | ✅ |
| AI Concierge — trip-aware Q&A with sources | ✅ |
| Day-by-day itinerary builder + feasibility engine | ⏳ schema ready, UI next |
| Formal votes with deadlines | ⏳ next |
| Expenses, packing, docs locker | ⏳ later |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API. **Bare origin**, not the `/rest/v1/` endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page. Server-only — never expose to the browser |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | defaults to `gemini-3.6-flash` |

### 3. Database

Open the Supabase dashboard → **SQL Editor** → **New query**, paste all of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and run it.

### 4. Run

```bash
npm run dev
```

---

## How anonymous access stays safe

There is no Supabase Auth user. That's a deliberate product call — your friends
should not need an account to vote on a restaurant — and it drives the whole
security design:

- **RLS is on for every table, with zero policies.** The public `anon` key can
  read and write nothing. It is never used for trip data.
- All reads and writes go through Next.js route handlers using the service role
  key, which stays server-side.
- Membership is proven by a per-member secret in an **httpOnly cookie**, hashed
  with SHA-256 before it touches the database.
- The invite link carries a **256-bit token**. The link *is* the credential, so
  it is unguessable by design. The short join code only resolves an existing
  trip — it never grants membership on its own.
- A trip can be **locked** to stop new joins once everyone is in.

The tradeoff to be aware of: anyone who obtains an invite link can join the trip.
That is the cost of zero-friction access. Lock the trip once your group is in.

**Upgrade path:** members can later claim their identity with Google OAuth
without losing history — a `user_id` column on `members` and a real RLS policy
set, with the cookie path kept for legacy members.

---

## AI notes

**Model:** `gemini-3.6-flash` — 1M context, thinking enabled. Verified live
against the models endpoint rather than assumed.

**Grounding is two-pass, and that's not optional.** Gemini rejects
`responseSchema` and the `googleSearch` tool in the same call. So
`researchThenStructure()` does:

1. a grounded search pass that collects real text and citations, then
2. an ungrounded pass that reshapes those findings into strict JSON.

The upside: the structuring pass reads *retrieved* text rather than the model's
recollection, so ratings and prices trace to a source we can show the user.

**Graceful degradation.** Search grounding needs quota. If Gemini returns 429,
`lib/gemini.ts` records it, degrades to ungrounded generation, and marks the
result `grounded: false` — which the UI renders as an **unverified** badge.
It re-probes after 10 minutes, so enabling billing lights grounding back up with
no redeploy.

**The house rule in every prompt:** never invent a number. A missing rating is
fine; a fabricated `4.7` is not.

---

## Layout

```
src/
  app/
    page.tsx              landing
    new/                  create a trip
    t/[code]/             the trip workspace (invite token or join code)
    api/trips/...         all mutations — the only path to the database
  components/             UI, all client components
  lib/
    dna.ts                Group DNA: agreement, splits, conflicts
    gemini.ts             model client, grounding fallback, citations
    suggest.ts            prompts for suggestions and the concierge
    session.ts            cookie-based membership
    api.ts                shared route plumbing
supabase/migrations/      paste-into-dashboard SQL
```

## Scripts

```bash
npm run dev        # dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint
```
