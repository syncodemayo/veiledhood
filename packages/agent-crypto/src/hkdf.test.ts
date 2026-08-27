import { test } from "node:test";
import assert from "node:assert/strict";
import { hkdfSha256 } from "./hkdf.js";

// RFC 5869 Test Case 1
// IKM  = 0x0b * 22
// salt = 0x000102030405060708090a0b0c (13 bytes)
// info = 0xf0f1f2f3f4f5f6f7f8f9 (10 bytes)
// L    = 42
// OKM  = 0x3cb25f25faacd57a90434f64d0362f2a 2d2d0a90cf1a5a4c5db02d56ecc4c5bf
//        34007208d5b887185865 (42 bytes)
test("hkdf RFC 5869 Test Case 1", async () => {
  const ikm = new Uint8Array(22).fill(0x0b);
  const salt = new Uint8Array([
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  ]);
  const info = new Uint8Array([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]);
  const expected = new Uint8Array([
    0x3c, 0xb2, 0x5f, 0x25, 0xfa, 0xac, 0xd5, 0x7a, 0x90, 0x43, 0x4f, 0x64, 0xd0, 0x36, 0x2f, 0x2a,
    0x2d, 0x2d, 0x0a, 0x90, 0xcf, 0x1a, 0x5a, 0x4c, 0x5d, 0xb0, 0x2d, 0x56, 0xec, 0xc4, 0xc5, 0xbf,
    0x34, 0x00, 0x72, 0x08, 0xd5, 0xb8, 0x87, 0x18, 0x58, 0x65,
  ]);

  const out = await hkdfSha256(ikm, salt, info, 42);
  assert.equal(out.length, 42);
  for (let i = 0; i < 42; i++) {
    assert.equal(out[i], expected[i], `byte ${i} mismatch`);
  }
});

test("hkdf throws when ikm < 16 bytes", async () => {
  const ikm = new Uint8Array(8).fill(1);
  await assert.rejects(() => hkdfSha256(ikm, "salt", "info", 32), /ikm must be >= 16 bytes/);
});

test("hkdf throws when length < 1", async () => {
  const ikm = new Uint8Array(16).fill(1);
  await assert.rejects(() => hkdfSha256(ikm, "salt", "info", 0), /length must be in/);
});

test("hkdf throws when length > 8160", async () => {
  const ikm = new Uint8Array(16).fill(1);
  await assert.rejects(() => hkdfSha256(ikm, "salt", "info", 8161), /length must be in/);
});

test("hkdf returns exact requested length", async () => {
  const ikm = new Uint8Array(32).fill(0xab);
  const out = await hkdfSha256(ikm, "veiledhood:test", "agt-1|dca", 64);
  assert.equal(out.constructor.name, "Uint8Array");
  assert.equal(out.length, 64);
});
