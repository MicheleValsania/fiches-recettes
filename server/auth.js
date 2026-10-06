import crypto from "node:crypto";

const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function safeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

export function createAuth({
  password = "",
  tokenSecret = "",
  serviceToken = "",
  tokenTtlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  now = () => Date.now(),
} = {}) {
  const normalizedPassword = String(password).trim();
  const normalizedTokenSecret = String(tokenSecret).trim();
  const normalizedServiceToken = String(serviceToken).trim();
  const authRequired = normalizedPassword.length > 0;

  if (authRequired && !normalizedTokenSecret) {
    throw new Error("AUTH_TOKEN_SECRET is required when APP_PASSWORD is configured.");
  }

  function sign(encodedPayload) {
    return crypto.createHmac("sha256", normalizedTokenSecret).update(encodedPayload).digest("base64url");
  }

  function issueSessionToken() {
    if (!authRequired) return null;
    const expiresAt = Math.floor(now() / 1000) + tokenTtlSeconds;
    const payload = Buffer.from(
      JSON.stringify({ exp: expiresAt, nonce: crypto.randomBytes(16).toString("base64url") })
    ).toString("base64url");
    return {
      token: `${payload}.${sign(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  function verifySessionToken(token) {
    if (!authRequired) return true;
    if (!token || typeof token !== "string") return false;
    const [payload, signature, ...rest] = token.split(".");
    if (!payload || !signature || rest.length > 0 || !safeEqual(signature, sign(payload))) return false;

    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return Number.isFinite(parsed.exp) && parsed.exp > Math.floor(now() / 1000);
    } catch {
      return false;
    }
  }

  function passwordMatches(candidate) {
    return authRequired && safeEqual(candidate || "", normalizedPassword);
  }

  function requestIsAuthorized(req) {
    if (!authRequired) return true;

    const providedServiceToken = req.get("x-service-token") || "";
    if (
      normalizedServiceToken &&
      providedServiceToken &&
      safeEqual(providedServiceToken, normalizedServiceToken)
    ) {
      return true;
    }

    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return Boolean(match && verifySessionToken(match[1]));
  }

  return {
    authRequired,
    issueSessionToken,
    passwordMatches,
    requestIsAuthorized,
    verifySessionToken,
  };
}

export function createLoginAttemptTracker({ maxFailures = 5, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const failuresByKey = new Map();

  function activeFailures(key) {
    const cutoff = now() - windowMs;
    const active = (failuresByKey.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (active.length > 0) failuresByKey.set(key, active);
    else failuresByKey.delete(key);
    return active;
  }

  return {
    isBlocked(key) {
      const failures = activeFailures(key);
      if (failures.length < maxFailures) return { blocked: false, retryAfterSeconds: 0 };
      const retryAfterSeconds = Math.max(1, Math.ceil((failures[0] + windowMs - now()) / 1000));
      return { blocked: true, retryAfterSeconds };
    },
    recordFailure(key) {
      const failures = activeFailures(key);
      failures.push(now());
      failuresByKey.set(key, failures);
    },
    reset(key) {
      failuresByKey.delete(key);
    },
  };
}
