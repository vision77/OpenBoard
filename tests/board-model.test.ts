import assert from "node:assert/strict";
import test from "node:test";
import { createElement, drawingWidth } from "../src/board-model";

test("creates a sticky element with the portable whiteboard defaults", () => {
  const element = createElement("STICKY", "page-1", 10, 20);
  assert.equal(element.pageId, "page-1");
  assert.equal(element.fill, "#fff3c9");
  assert.equal(element.text, "Write something useful");
});

test("uses pressure to derive a bounded pen stroke width", () => {
  const narrow = drawingWidth("PEN", 0.05);
  const wide = drawingWidth("PEN", 1);
  assert.ok(narrow < wide);
  assert.ok(wide <= 32);
});
