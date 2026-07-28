export type BudgetLevel = 'shoestring' | 'value' | 'comfort' | 'luxury';
export type Pace = 'chill' | 'balanced' | 'packed';
export type WakeTime = 'early' | 'mid' | 'late';
export type Intensity = 'low' | 'moderate' | 'high';
export type ReactionValue = 'must' | 'keen' | 'meh' | 'no';
export type IdeaCategory = 'sight' | 'food' | 'activity' | 'stay' | 'transport' | 'experience';

export const INTERESTS = [
  'food',
  'nature',
  'nightlife',
  'culture',
  'adventure',
  'photography',
  'shopping',
  'wellness',
] as const;
export type Interest = (typeof INTERESTS)[number];

export const DIETARY = [
  'vegetarian',
  'vegan',
  'jain',
  'halal',
  'no-beef',
  'no-pork',
  'gluten-free',
  'seafood-allergy',
] as const;

/** Weight each reaction contributes to an idea's group score. */
export const REACTION_WEIGHT: Record<ReactionValue, number> = {
  must: 3,
  keen: 1,
  meh: 0,
  no: -3,
};

export interface Trip {
  id: string;
  join_code: string;
  invite_token: string;
  name: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  party_size: number;
  budget_level: BudgetLevel | null;
  currency: string;
  brief: string | null;
  locked: boolean;
  plans_state: PlansState;
  plans_claimed_at: string | null;
  plans_revealed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  trip_id: string;
  display_name: string;
  avatar_emoji: string;
  color: string;
  role: 'owner' | 'member';
  removed: boolean;
  last_seen_at: string;
  created_at: string;
}

export interface Preferences {
  member_id: string;
  trip_id: string;
  pace: Pace | null;
  budget_level: BudgetLevel | null;
  interests: string[];
  wake_time: WakeTime | null;
  dietary: string[];
  intensity: Intensity | null;
  non_negotiables: string | null;
  updated_at: string;
}

export interface Citation {
  title: string;
  uri: string;
}

export interface Idea {
  id: string;
  trip_id: string;
  title: string;
  category: IdeaCategory;
  locality: string | null;
  description: string | null;
  why_fits: string | null;
  rating: number | null;
  rating_count: number | null;
  price_note: string | null;
  duration_hours: number | null;
  best_time: string | null;
  booking_url: string | null;
  image_url: string | null;
  lat: number | null;
  lng: number | null;
  source: 'ai' | 'member' | 'link';
  sources: Citation[];
  grounded: boolean;
  added_by: string | null;
  created_at: string;
}

export interface Reaction {
  idea_id: string;
  member_id: string;
  value: ReactionValue;
}

export type PlansState = 'none' | 'generating' | 'ready' | 'failed';

export interface PlanDay {
  id: string;
  plan_id: string;
  day_index: number;
  title: string;
  locality: string | null;
  summary: string | null;
  items: {
    title: string;
    kind?: 'activity' | 'meal' | 'travel' | 'rest';
    duration_hours?: number;
    note?: string;
  }[];
  warnings: { level: 'warn' | 'clash'; message: string }[];
}

export interface Plan {
  id: string;
  trip_id: string;
  label: string;
  tagline: string;
  tradeoff: string;
  cost_estimate: string | null;
  intensity: 'low' | 'moderate' | 'high' | null;
  best_for: string | null;
  sources: Citation[];
  grounded: boolean;
  seed: number;
  created_at: string;
  days: PlanDay[];
}

/**
 * What the client is allowed to know about the vote.
 *
 * While voting is blind this carries only the member's own ranking and how many
 * people have voted -- never who voted for what, and never a tally. Those
 * fields stay undefined until reveal, so a curious member reading the network
 * response learns nothing they shouldn't.
 */
export interface PlanVoteView {
  revealed: boolean;
  votedCount: number;
  totalMembers: number;
  myRanking: string[];
  results?: {
    planId: string;
    points: number;
    firsts: number;
    noVetoes: boolean;
  }[];
}

/** An idea plus the group's aggregate verdict on it. */
export interface ScoredIdea extends Idea {
  reactions: Reaction[];
  score: number;
  /** True when at least one member vetoed it. */
  contested: boolean;
  votesIn: number;
}
