import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleWalletStatus } from "./walletStatus.js";
import {
  setupTestEnv,
  cleanupTestEnv,
  stubFetch,
  makeResponse,
  TEST_ADDR,
  type TestEnv,
  type FetchStub,
} from "../test/setup.js";

let env: TestEnv;
let fetchStub: FetchStub | undefined;

beforeEach(async () => {
  env = await setupTestEnv();
});
afterEach(async () => {
  fetchStub?.restore();
  fetchStub = undefined;
  await cleanupTestEnv(env);
});

test("wallet_status reports session + Backend OK when /user/me succeeds", async () => {
  fetchStub = stubFetch((url) => {
    assert.ok(url.includes("/user/me"), `url=${url}`);
    return makeResponse(200, { address: TEST_ADDR, balances: [], hasVaultBalance: false });
  });

  const res = await handleWalletStatus();
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("Veiledhood MCP v0.1.0"));
  assert.ok(text.includes(TEST_ADDR));
  assert.ok(text.includes("Backend OK"));
});

test("wallet_status reports unreachable backend gracefully (still OK)", async () => {
  fetchStub = stubFetch(() => {
    throw new TypeError("ECONNREFUSED");
  });
  const res = await handleWalletStatus();
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes(TEST_ADDR));
  assert.ok(text.includes("Backend unreachable"));
});
