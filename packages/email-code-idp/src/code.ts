// Minting and checking the digits that go in the email.
//
// Everything here is pure and synchronous apart from the digest, so the policy this file encodes --
// how a code is drawn, how it is stored, how a guess is compared -- can be tested without a Worker,
// a Durable Object, or a clock.

/** How many digits a sign-in code carries. */
export const CODE_DIGITS = 6;

const CODE_SPACE = 10 ** CODE_DIGITS;

/**
 * A uniformly drawn decimal code, zero-padded to {@link CODE_DIGITS}.
 *
 * Rejection sampling rather than `% CODE_SPACE`: 2^32 is not a multiple of 10^6, so a bare modulo
 * would make the lowest 4,294 codes about 0.02% likelier than the rest. That bias is far too small
 * to matter against a five-guess limit, and it costs one comparison to not have, which is the
 * better trade for the one value in this Worker an attacker is trying to guess.
 */
export function generateCode(): string {
  const limit = Math.floor(0x1_0000_0000 / CODE_SPACE) * CODE_SPACE;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return String(value % CODE_SPACE).padStart(CODE_DIGITS, "0");
}

/** A 256-bit random identifier, hex encoded. Used for session ids and authorization codes. */
export function generateToken(): string {
  return crypto.getRandomValues(new Uint8Array(32)).toHex();
}

/**
 * What gets stored in place of a code.
 *
 * Salted with the session id, which never leaves the browser that started the flow and the Durable
 * Object holding it. Six digits is a small enough space that an unsalted digest is a lookup table,
 * so this is what makes stored state useless on its own.
 */
export async function codeDigest(sessionId: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sessionId}:${code}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The attempt limit already bounds guessing far below what a timing signal would buy, so this is
 * belt rather than braces -- but a comparison that leaks a prefix is not worth keeping when the
 * alternative is four lines.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * A typed code, cleaned up.
 *
 * People paste "123 456" and "123-456" out of a mail client, and a login page that rejects those is
 * annoying in exactly the situation where the user is already irritated.
 */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/** Whether a cleaned-up entry could be a code at all, checked before spending an attempt on it. */
export function isCodeShaped(code: string): boolean {
  return new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code);
}

/**
 * The address as this Worker will assert it.
 *
 * Lower-cased, because the `email` claim becomes the Workshop account identity and the entry
 * matched against `access.admins`. Addresses are not case-insensitive by RFC, but every mail
 * provider in practice treats them so, and folding here is what stops `Ada@example.com` and
 * `ada@example.com` becoming two accounts with two sets of chats.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Deliberately loose: real delivery is the check that matters, this only rejects obvious junk. */
export function isEmailShaped(email: string): boolean {
  return /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(email);
}

/**
 * A stable, opaque `sub` for an address.
 *
 * Access keys users on `email`; `sub` exists because OIDC requires one. Deriving it from the
 * address keeps it stable across logins without storing a user record anywhere -- this Worker has
 * no user table, and not having one is a deliberate part of its blast radius.
 */
export async function subjectFor(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(`sub:${email}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
}
