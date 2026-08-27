import assert from "node:assert/strict";
import test from "node:test";
import { mockRoutingRequest } from "./browser-route-mock.mjs";

test("browser route mock ignores unrelated Worker requests", () => {
  let calls = 0;
  const input = { cdp: { call() { calls += 1; } }, sessionId: "session", requestId: "request", origin: "http://127.0.0.1" };
  assert.equal(mockRoutingRequest({ ...input, request: { url: "https://happyroad-routing.aaarmsdn-happyroad.workers.dev/not-a-route", method: "POST", postData: "{}" } }), null);
  assert.equal(mockRoutingRequest({ ...input, request: { url: "https://happyroad-routing.aaarmsdn-happyroad.workers.dev/route", method: "GET" } }), null);
  assert.equal(calls, 0);
});

test("browser route mock handles reverse geocoding", async () => {
  let fulfilled;
  const result = mockRoutingRequest({
    cdp: { call(_method, options) { fulfilled = options; return Promise.resolve(); } }, sessionId: "session", requestId: "request", origin: "http://127.0.0.1",
    request: { url: "https://happyroad-routing.aaarmsdn-happyroad.workers.dev/address?lat=37.5&lng=127", method: "GET" }
  });
  await result;
  assert.equal(JSON.parse(Buffer.from(fulfilled.body, "base64")).address, "서울 성동구 성수일로 12-3");
});

test("browser route mock returns every batched mode", async () => {
  let fulfilled;
  const routes = ["walk", "car", "public-transit"].map((mode, id) => ({
    id, mode, start: { lat: 37.5, lng: 127 }, end: { lat: 37.51, lng: 127.01 }
  }));
  await mockRoutingRequest({
    cdp: { call(_method, options) { fulfilled = options; return Promise.resolve(); } }, sessionId: "session", requestId: "request", origin: "http://127.0.0.1",
    request: { url: "https://happyroad-routing.aaarmsdn-happyroad.workers.dev/routes", method: "POST", postData: JSON.stringify({ routes }) }
  });
  const payload = JSON.parse(Buffer.from(fulfilled.body, "base64"));
  assert.deepEqual(payload.routes.map(item => item.route.minutes), [12, 6, 18]);
  assert.deepEqual(payload.routes.map(item => item.route.distanceMeters), [900, 4200, 5000]);
});
