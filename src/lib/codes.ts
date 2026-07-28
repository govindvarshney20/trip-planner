import { randomBytes, createHash } from 'node:crypto';

/**
 * Join codes are meant to be read aloud across a dinner table, so they avoid
 * ambiguous characters and use travel-flavoured words rather than random
 * strings. They are a convenience, not a secret -- the invite token is the
 * real credential.
 */
const ADJECTIVES = [
  'misty', 'golden', 'quiet', 'wild', 'amber', 'jade', 'silver', 'hidden',
  'sunlit', 'roaming', 'distant', 'coastal', 'alpine', 'monsoon', 'lantern',
];

const NOUNS = [
  'karst', 'delta', 'ridge', 'harbour', 'bazaar', 'summit', 'lagoon', 'valley',
  'temple', 'terrace', 'pass', 'cove', 'plateau', 'river', 'trail',
];

function pick<T>(arr: T[]): T {
  // rejection-free modulo bias avoidance is overkill here, but cheap:
  const max = Math.floor(256 / arr.length) * arr.length;
  let b: number;
  do {
    b = randomBytes(1)[0];
  } while (b >= max);
  return arr[b % arr.length];
}

export function generateJoinCode(): string {
  const n = randomBytes(2).readUInt16BE(0) % 1000;
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${String(n).padStart(3, '0')}`.toUpperCase();
}

/** 256 bits of entropy. This is what makes an unlisted invite link safe. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Per-member secret, stored raw in the member's cookie and hashed in the DB. */
export function generateMemberSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function normalizeJoinCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-');
}
