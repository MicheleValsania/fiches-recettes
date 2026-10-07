import assert from "node:assert/strict";
import test from "node:test";

import { asyncRoute } from "./http.js";

test("asyncRoute forwards rejected promises to Express error handling", async () => {
  const expected = new Error("database unavailable");
  let forwarded = null;
  const wrapped = asyncRoute(async () => {
    throw expected;
  });

  wrapped({}, {}, (error) => {
    forwarded = error;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(forwarded, expected);
});

