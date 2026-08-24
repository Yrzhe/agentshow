// Durable Objects, which is where "single use" actually comes from.
//
// KV would be the cheaper home for short-lived records, and the wrong one: its reads are eventually
// consistent, so two requests carrying the same code can both read it as unspent. A code that can
// be redeemed twice under a race is not single-use, and this Worker exists because of what happens
// when a code is spent more than once. Every record below therefore lives in a Durable Object,
// where the read and the delete that consumes it happen in the same single-threaded actor.

import { DurableObject } from "cloudflare:workers";
import { codeDigest, timingSafeEqual } from "./code.js";
import { generateKeyPair, type StoredKeyPair } from "./jwt.js";

/** The OIDC request a login flow was started for, held so the callback can be rebuilt. */
export interface AuthRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  nonce: string | null;
}

/** Why a submitted code was not accepted. Shown to the user, so each is a distinct sentence. */
export type VerifyFailure = "no-code" | "expired" | "mismatch" | "too-many-attempts";

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: VerifyFailure; attemptsLeft: number };

interface PendingCode {
  digest: string;
  expiresAt: number;
  attempts: number;
}

/**
 * One browser's trip through the login page: the OIDC request it started, the address it claimed,
 * and the code outstanding for that address.
 *
 * Addressed by an unguessable session id that only ever exists in the form the user is looking at.
 * That is what makes a code useless to anyone holding only the email: redeeming one requires the
 * page it was requested from, which is also why the mail can honestly say so.
 */
export class LoginSession extends DurableObject<Cloudflare.Env> {
  async start(request: AuthRequest, ttlMs: number): Promise<void> {
    this.ctx.storage.kv.put("request", request);
    // The session outlives any one code so that a wrong entry can be retried, but not indefinitely.
    this.ctx.storage.kv.put("expiresAt", Date.now() + ttlMs);
    await this.ctx.storage.setAlarm(Date.now() + ttlMs);
  }

  async request(): Promise<AuthRequest | null> {
    if (this.#expired()) return null;
    return this.ctx.storage.kv.get<AuthRequest>("request") ?? null;
  }

  /**
   * The address this session asked for a code at.
   *
   * Not called `email`: workerd reserves that name for the Email Routing handler on an entrypoint,
   * so an RPC method of that name is silently not callable.
   */
  async claimedEmail(): Promise<string | null> {
    if (this.#expired()) return null;
    return this.ctx.storage.kv.get<string>("email") ?? null;
  }

  /**
   * Records a freshly minted code for `email`, replacing any code already outstanding.
   *
   * Replacing rather than adding is the same rule Cloudflare's own PIN follows, and it is worth
   * stating in the mail: a person who presses resend and then types the older code is holding a
   * code this Worker deliberately dropped.
   */
  async issue(email: string, code: string, ttlMs: number): Promise<void> {
    const sessionId = this.ctx.id.toString();
    this.ctx.storage.kv.put("email", email);
    this.ctx.storage.kv.put<PendingCode>("code", {
      digest: await codeDigest(sessionId, code),
      expiresAt: Date.now() + ttlMs,
      attempts: 0,
    });
    this.ctx.storage.kv.put("sends", (this.ctx.storage.kv.get<number>("sends") ?? 0) + 1);
  }

  /** How many codes this session has asked for, so a resend button cannot become a mail cannon. */
  async sends(): Promise<number> {
    return this.ctx.storage.kv.get<number>("sends") ?? 0;
  }

  /**
   * Spends one attempt against the outstanding code.
   *
   * A correct guess deletes the code before returning, in the same actor turn that read it, so a
   * replay -- or two tabs submitting at once -- finds nothing rather than a second success.
   */
  async verify(code: string, maxAttempts: number): Promise<VerifyResult> {
    const pending = this.ctx.storage.kv.get<PendingCode>("code");
    if (!pending || this.#expired()) {
      return { ok: false, reason: "no-code", attemptsLeft: 0 };
    }
    if (Date.now() >= pending.expiresAt) {
      this.ctx.storage.kv.delete("code");
      return { ok: false, reason: "expired", attemptsLeft: 0 };
    }
    const digest = await codeDigest(this.ctx.id.toString(), code);
    if (!timingSafeEqual(digest, pending.digest)) {
      const attempts = pending.attempts + 1;
      if (attempts >= maxAttempts) {
        // Burn it rather than counting further: the code is now closer to guessed than to secret.
        this.ctx.storage.kv.delete("code");
        return { ok: false, reason: "too-many-attempts", attemptsLeft: 0 };
      }
      this.ctx.storage.kv.put<PendingCode>("code", { ...pending, attempts });
      return { ok: false, reason: "mismatch", attemptsLeft: maxAttempts - attempts };
    }
    this.ctx.storage.kv.delete("code");
    const email = this.ctx.storage.kv.get<string>("email");
    if (!email) return { ok: false, reason: "no-code", attemptsLeft: 0 };
    return { ok: true, email };
  }

  /** Called once the flow has produced an authorization code; nothing here is needed again. */
  async finish(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  #expired(): boolean {
    const expiresAt = this.ctx.storage.kv.get<number>("expiresAt");
    return expiresAt === undefined || Date.now() >= expiresAt;
  }
}

/** What a redeemed authorization code yields. */
export interface AuthCodeRecord {
  email: string;
  clientId: string;
  redirectUri: string;
  nonce: string | null;
  expiresAt: number;
}

/**
 * One issued authorization code, addressed by its own digest.
 *
 * Short-lived and consumed on first exchange, for the same reason the sign-in code is: the token
 * endpoint is reachable by anyone who can replay a callback URL.
 */
export class AuthCode extends DurableObject<Cloudflare.Env> {
  async put(record: AuthCodeRecord): Promise<void> {
    this.ctx.storage.kv.put("record", record);
    await this.ctx.storage.setAlarm(record.expiresAt);
  }

  /** Returns the record and deletes it, or null when it never existed, expired, or was redeemed. */
  async redeem(): Promise<AuthCodeRecord | null> {
    const record = this.ctx.storage.kv.get<AuthCodeRecord>("record");
    await this.ctx.storage.deleteAll();
    if (!record || Date.now() >= record.expiresAt) return null;
    return record;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/**
 * How many codes one address has been sent lately, addressed by the address itself.
 *
 * Session-level limits do not cover this: a script can open a new session per request and mail the
 * same person forever. The recipient is the thing being protected, so the recipient is the key.
 */
export class EmailThrottle extends DurableObject<Cloudflare.Env> {
  /** Records a send, returning false when this address has had its allowance for the window. */
  async allow(limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const sends = (this.ctx.storage.kv.get<number[]>("sends") ?? [])
      .filter((at) => now - at < windowMs);
    if (sends.length >= limit) {
      this.ctx.storage.kv.put("sends", sends);
      return false;
    }
    sends.push(now);
    this.ctx.storage.kv.put("sends", sends);
    await this.ctx.storage.setAlarm(now + windowMs);
    return true;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/**
 * The deployment's signing key.
 *
 * A singleton, generated on first use rather than configured: a private key in `deployment.jsonc`
 * or in a Worker secret is a private key in somebody's clipboard, and nothing outside this Worker
 * needs it. Verifiers get the public half from the JWKS endpoint.
 */
export class SigningKey extends DurableObject<Cloudflare.Env> {
  async current(): Promise<StoredKeyPair> {
    // Generation takes long enough that two cold requests could otherwise both mint one and the
    // second would overwrite the key the first had already signed with.
    return await this.ctx.blockConcurrencyWhile(async () => {
      const existing = this.ctx.storage.kv.get<StoredKeyPair>("keys");
      if (existing) return existing;
      const generated = await generateKeyPair();
      this.ctx.storage.kv.put("keys", generated);
      return generated;
    });
  }
}
