import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  randomBytes,
  utf8Decode,
  utf8Encode,
} from "./util.js";

test("base64 round-trip on edge bytes", () => {
  const input = new Uint8Array([0, 255, 1, 2, 254]);
  const b64 = bytesToBase64(input);
  const out = base64ToBytes(b64);
  assert.equal(out.length, input.length);
  for (let i = 0; i < input.length; i++) {
    assert.equal(out[i], input[i]);
  }
});

test("utf8 round-trip emoji + ASCII", () => {
  const s = "Hello, world! 🌍✨ 你好";
  const bytes = utf8Encode(s);
  const back = utf8Decode(bytes);
  assert.equal(back, s);
});

test("randomBytes(32) produces 32 bytes, not all zero", () => {
  const r = randomBytes(32);
  assert.equal(r.length, 32);
  const allZero = r.every((b) => b === 0);
  assert.equal(allZero, false);
});

test("constantTimeEqual: equal arrays => true", () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(constantTimeEqual(a, b), true);
});

test("constantTimeEqual: different arrays => false", () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array([1, 2, 3, 4, 6]);
  assert.equal(constantTimeEqual(a, b), false);
});

test("constantTimeEqual: different lengths => false", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 3, 4]);
  assert.equal(constantTimeEqual(a, b), false);
});
