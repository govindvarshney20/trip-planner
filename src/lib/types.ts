export type BudgetLevel = 'shoestring' | 'value' | 'comfort' | 'luxury';
export type Pace = 'chill' | 'balanced' | 'packed';
export type WakeTime = 'early' | 'mid' | 'late';
export type Intensity = 'low' | 'moderate' | 'high';

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

export interface Trip {
  id: string;
  join_code: string;
  invite_token: string;
  name: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  /** 'YYYY-MM'. Primary "when" signal until exact dates are committed. */
  travel_month: string | null;
  /** Authoritative trip length; read it via tripDays(), not from the dates. */
  day_count: number | null;
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


export type PlansState = 'none' | 'generating' | 'ready' | 'failed';

export type StopKind = 'activity' | 'meal' | 'travel' | 'stay' | 'rest';
export type StopStatus = 'proposed' | 'accepted' | 'removed';
export type StopVoteValue = 'keep' | 'drop';

export interface DayWarning {
  level: 'warn' | 'clash';
  message: string;
}

export interface TripDay {
  trip_id: string;
  day_index: number;
  title: string;
  locality: string | null;
  summary: string | null;
  warnings: DayWarning[];
}

/** Deep detail, fetched on demand and cached on the stop row. */
export interface StopDetail {
  what_it_is?: string;
  what_people_say?: string;
  rating?: number;
  rating_count?: number;
  fees?: string;
  opening_hours?: string;
  best_time?: string;
  duration_hours?: number;
  tips?: string[];
  watch_out_for?: string[];
  getting_there?: string;
}

export interface PlanStop {
  id: string;
  trip_id: string;
  day_index: number;
  position: number;
  title: string;
  locality: string | null;
  kind: StopKind;
  summary: string | null;
  why_included: string | null;
  duration_hours: number | null;
  cost_note: string | null;
  best_time: string | null;
  status: StopStatus;
  detail: StopDetail | null;
  detail_sources: Citation[];
  detail_grounded: boolean;
  detail_fetched_at: string | null;
  created_at: string;
}

export interface StopVote {
  stop_id: string;
  member_id: string;
  value: StopVoteValue;
}

export interface StopAlternative {
  id: string;
  stop_id: string;
  title: string;
  locality: string | null;
  summary: string | null;
  why: string | null;
  duration_hours: number | null;
  cost_note: string | null;
  sources: Citation[];
  grounded: boolean;
}

/** A stop with its votes folded in, ready to render. */
export interface StopWithVotes extends PlanStop {
  votes: StopVote[];
  keeps: number;
  drops: number;
  myVote: StopVoteValue | null;
}

export interface ItineraryDay extends TripDay {
  stops: StopWithVotes[];
  /** Hours of travel in this day, so a brutal transfer day is visible at a glance. */
  travelHours: number;
  activeHours: number;
}

