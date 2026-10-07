import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./passwords.js";

test("personal passwords are salted and verifiable", async () => {
  const password = "a-secure-personal-password";
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("incorrect-password", first), false);
});

test("personal passwords require at least twelve characters", async () => {
  await assert.rejects(hashPassword("too-short"), /at least 12/);
});
