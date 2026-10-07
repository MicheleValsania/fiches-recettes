import assert from "node:assert/strict";
import test from "node:test";

import { createAuth, createLoginAttemptTracker, safeEqual } from "./auth.js";

function requestWith(headers = {}) {
  return {
    get(name) {
      return headers[name.toLowerCase()] || "";
    },
  };
}

test("safeEqual compares secrets without requiring equal input lengths", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("short", "a much longer value"), false);
});

test("session tokens are signed and expire", () => {
  let timestamp = Date.parse("2026-10-06T08:00:00Z");
  const auth = createAuth({
    password: "a-long-password",
    tokenSecret: "a-separate-signing-secret",
    tenantId: "tenant-france",
    tokenTtlSeconds: 60,
    now: () => timestamp,
  });
  const session = auth.issueSessionToken();

  assert.equal(auth.verifySessionToken(session.token), true);
  assert.equal(auth.readSessionToken(session.token).tenantId, "tenant-france");
  assert.equal(auth.verifySessionToken(`${session.token}tampered`), false);
  timestamp += 61_000;
  assert.equal(auth.verifySessionToken(session.token), false);
});

test("browser sessions and service tokens authorize independently", () => {
  const auth = createAuth({
    password: "browser-password",
    tokenSecret: "signing-secret",
    serviceToken: "cookops-service-token",
    tenantId: "tenant-france",
  });
  const session = auth.issueSessionToken();

  assert.equal(auth.requestIsAuthorized(requestWith()), false);
  assert.equal(
    auth.requestIsAuthorized(requestWith({ authorization: `Bearer ${session.token}` })),
    true
  );
  assert.equal(
    auth.requestIsAuthorized(requestWith({ "x-service-token": "cookops-service-token" })),
    true
  );
  assert.deepEqual(
    auth.requestAuth(requestWith({ "x-service-token": "cookops-service-token" })),
    { tenantId: "tenant-france", kind: "service" }
  );
});

test("tokens cannot be reused by another tenant", () => {
  const france = createAuth({ password: "password", tokenSecret: "shared-secret", tenantId: "tenant-france" });
  const italy = createAuth({ password: "password", tokenSecret: "shared-secret", tenantId: "tenant-italy" });
  const session = france.issueSessionToken();

  assert.equal(france.verifySessionToken(session.token), true);
  assert.equal(italy.verifySessionToken(session.token), false);
});

test("login attempt tracking blocks repeated failures and resets after success", () => {
  let timestamp = 1_000;
  const attempts = createLoginAttemptTracker({ maxFailures: 2, windowMs: 10_000, now: () => timestamp });

  attempts.recordFailure("client");
  assert.equal(attempts.isBlocked("client").blocked, false);
  attempts.recordFailure("client");
  assert.equal(attempts.isBlocked("client").blocked, true);
  attempts.reset("client");
  assert.equal(attempts.isBlocked("client").blocked, false);
  attempts.recordFailure("client");
  timestamp += 11_000;
  assert.equal(attempts.isBlocked("client").blocked, false);
});
