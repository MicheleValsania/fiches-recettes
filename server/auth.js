import crypto from "node:crypto";

const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function safeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

export function createAuth({
  enabled,
  password = "",
  tokenSecret = "",
  serviceToken = "",
  tenantId = "",
  tokenTtlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  now = () => Date.now(),
} = {}) {
  const normalizedPassword = String(password).trim();
  const normalizedTokenSecret = String(tokenSecret).trim();
  const normalizedServiceToken = String(serviceToken).trim();
  const normalizedTenantId = String(tenantId).trim();
  const authRequired = enabled ?? normalizedPassword.length > 0;

  if (authRequired && !normalizedTokenSecret) {
    throw new Error("AUTH_TOKEN_SECRET is required when authentication is enabled.");
  }
  if (!normalizedTenantId) {
    throw new Error("A tenantId is required for every authentication context.");
  }

  function sign(encodedPayload) {
    return crypto.createHmac("sha256", normalizedTokenSecret).update(encodedPayload).digest("base64url");
  }

  function issueSessionToken({ tenantId: sessionTenantId, userId = null, role = "owner" } = {}) {
    if (!authRequired) return null;
    const tokenTenantId = String(sessionTenantId || normalizedTenantId).trim();
    if (!tokenTenantId) throw new Error("A tenantId is required to issue a session token.");
    const expiresAt = Math.floor(now() / 1000) + tokenTtlSeconds;
    const payload = Buffer.from(
      JSON.stringify({
        exp: expiresAt,
        tid: tokenTenantId,
        uid: userId ? String(userId) : null,
        role: String(role || "viewer"),
        nonce: crypto.randomBytes(16).toString("base64url"),
      })
    ).toString("base64url");
    return {
      token: `${payload}.${sign(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  function readSessionToken(token) {
    if (!token || typeof token !== "string") return null;
    const [payload, signature, ...rest] = token.split(".");
    if (!payload || !signature || rest.length > 0 || !safeEqual(signature, sign(payload))) return null;

    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!Number.isFinite(parsed.exp) || parsed.exp <= Math.floor(now() / 1000)) return null;
      if (typeof parsed.tid !== "string" || !parsed.tid.trim()) return null;
      if (typeof parsed.role !== "string" || !parsed.role.trim()) return null;
      return {
        tenantId: parsed.tid,
        userId: typeof parsed.uid === "string" && parsed.uid ? parsed.uid : null,
        role: parsed.role,
        expiresAt: parsed.exp,
      };
    } catch {
      return null;
    }
  }

  function verifySessionToken(token) {
    return Boolean(readSessionToken(token));
  }

  function passwordMatches(candidate) {
    return authRequired && Boolean(normalizedPassword) && safeEqual(candidate || "", normalizedPassword);
  }

  function requestAuth(req) {
    if (!authRequired) {
      return { tenantId: normalizedTenantId, userId: null, role: "owner", kind: "development" };
    }

    const providedServiceToken = req.get("x-service-token") || "";
    if (
      normalizedServiceToken &&
      providedServiceToken &&
      safeEqual(providedServiceToken, normalizedServiceToken)
    ) {
      return { tenantId: normalizedTenantId, userId: null, role: "service", kind: "service" };
    }

    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const session = readSessionToken(match[1]);
    return session
      ? { tenantId: session.tenantId, userId: session.userId, role: session.role, kind: "session" }
      : null;
  }

  function requestIsAuthorized(req) {
    return Boolean(requestAuth(req));
  }

  return {
    authRequired,
    issueSessionToken,
    passwordMatches,
    readSessionToken,
    requestAuth,
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
