// RS256 signing, and the JWKS shape Access fetches to verify what this Worker issues.
//
// RS256 rather than something shorter: Cloudflare Access's generic OIDC integration reads the
// provider's JWKS and verifies the id_token itself, and RSA is the algorithm every OIDC verifier
// supports without negotiation. The key never leaves the Durable Object that generated it.

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** A key pair as it is persisted, plus the `kid` that ties a token to it. */
export interface StoredKeyPair {
  kid: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

/** Generates a fresh signing key. Called once, the first time a deployment issues a token. */
export async function generateKeyPair(): Promise<StoredKeyPair> {
  // Both casts narrow an overload that is declared to cover symmetric keys and raw exports too;
  // an RSA `generateKey` always yields a pair, and a `"jwk"` export always yields a JWK.
  const pair = await crypto.subtle.generateKey(
    { ...ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const [exportedPrivate, exportedPublic] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
  ]) as [JsonWebKey, JsonWebKey];
  return {
    kid: crypto.getRandomValues(new Uint8Array(8)).toHex(),
    privateJwk: exportedPrivate,
    publicJwk: exportedPublic,
  };
}

/** The public half, in the form a JWKS document lists it. */
export function publicJwk(stored: StoredKeyPair): JsonWebKey & { kid: string } {
  // Only the fields a verifier needs. An exported JWK carries `key_ops` and `ext`, which say
  // nothing useful in a JWKS and invite a strict verifier to disagree about them.
  const { kty, n, e } = stored.publicJwk;
  return { kty, n, e, kid: stored.kid, use: "sig", alg: "RS256" };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeSegment(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeBase64url(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Claims from a token this Worker signed, or null when it did not sign it or the token has expired.
 *
 * Only used for the access tokens `/userinfo` accepts. Making those verifiable rather than
 * storable is what lets this Worker keep no session table at all: the token carries its own claims,
 * and the signature is what makes them trustworthy.
 */
export async function verifyJwt(
  token: string, stored: StoredKeyPair,
): Promise<Record<string, unknown> | null> {
  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64url(headerSegment))) as
      { alg?: string; kid?: string };
    if (header.alg !== "RS256" || header.kid !== stored.kid) return null;
    const key = await crypto.subtle.importKey("jwk", stored.publicJwk, ALGORITHM, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      ALGORITHM.name,
      key,
      decodeBase64url(signatureSegment),
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64url(payloadSegment))) as
      Record<string, unknown>;
    const expiry = claims["exp"];
    if (typeof expiry !== "number" || Date.now() >= expiry * 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Signs `claims` as a compact JWS. */
export async function signJwt(claims: Record<string, unknown>, stored: StoredKeyPair): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", stored.privateJwk, ALGORITHM, false, ["sign"]);
  const signingInput =
    `${encodeSegment({ alg: "RS256", typ: "JWT", kid: stored.kid })}.${encodeSegment(claims)}`;
  const signature = await crypto.subtle.sign(
    ALGORITHM.name, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
