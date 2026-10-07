import assert from "node:assert/strict";
import test from "node:test";

import { createSessionValidator } from "./sessionAccess.js";

const personalSession = {
  tenantId: "tenant-france",
  userId: "user-1",
  role: "owner",
  kind: "session",
};

test("personal sessions are validated against the exact tenant membership", async () => {
  const checked = [];
  const validate = createSessionValidator(async (identity) => {
    checked.push(identity);
    return identity.tenantId === "tenant-france" ? { active: true, role: "editor" } : null;
  });

  assert.deepEqual(await validate(personalSession), { ...personalSession, role: "editor" });
  assert.deepEqual(checked, [{ userId: "user-1", tenantId: "tenant-france" }]);
  assert.equal(await validate({ ...personalSession, tenantId: "tenant-italy" }), null);
});

test("disabled users and removed memberships revoke an existing session", async () => {
  const disabled = createSessionValidator(async () => ({ active: false, role: "owner" }));
  const removed = createSessionValidator(async () => null);

  assert.equal(await disabled(personalSession), null);
  assert.equal(await removed(personalSession), null);
});

test("legacy and service contexts do not require a personal membership", async () => {
  const validate = createSessionValidator(async () => {
    throw new Error("membership lookup should not run");
  });
  const legacy = { tenantId: "tenant-france", userId: null, role: "owner", kind: "session" };
  const service = { tenantId: "tenant-france", userId: null, role: "service", kind: "service" };

  assert.equal(await validate(legacy), legacy);
  assert.equal(await validate(service), service);
});

