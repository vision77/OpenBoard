import assert from "node:assert/strict";
import test from "node:test";

test("repository language policy has no Chinese characters", () => {
  assert.doesNotMatch("Openboard", /[\u3400-\u9FFF]/);
});
