import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../worker/src/index.js";

test("worker rejects successful route payloads without drawable geometry", async () => {
  const env = { KAKAO_REST_API_KEY: "secret", ALLOWED_ORIGIN: "https://aaarmsdn.github.io", ROUTE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const fetcher = async () => Response.json({ route: {
    properties: { totalTime: 900, totalDistance: 1100 },
    steps: [{ properties: { time: 900, distance: 1100, guidance: "도보 이동" } }]
  } });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "walk" })
  }), env, fetcher, async () => true);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "route_not_found" });
});

test("worker rejects route geometry unrelated to requested endpoints", async () => {
  const env = { KAKAO_REST_API_KEY: "secret", ALLOWED_ORIGIN: "https://aaarmsdn.github.io", ROUTE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const fetcher = async () => Response.json({ route: {
    properties: { totalTime: 900, totalDistance: 1100 },
    steps: [{ properties: { time: 900, distance: 1100, guidance: "도보 이동" }, path: { points: [[127.7, 37.7], [127.71, 37.71]] } }]
  } });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "walk" })
  }), env, fetcher, async () => true);
  assert.equal(response.status, 404);
});

test("worker rejects geometry missing a substantial start or end segment", async () => {
  const env = { KAKAO_REST_API_KEY: "secret", ALLOWED_ORIGIN: "https://aaarmsdn.github.io", ROUTE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  for (const missing of ["start", "end"]) {
    const fetcher = async () => Response.json({ route: {
      properties: { totalTime: 900, totalDistance: 1100 },
      steps: [{
        properties: { time: 900, distance: 1100, guidance: "도보 이동" },
        path: { points: missing === "start" ? [[127, 37.508], [127.1, 37.4]] : [[127, 37.5], [127.1, 37.408]] }
      }]
    } });
    const response = await handleRequest(new Request("https://worker.test/route", {
      method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "walk" })
    }), env, fetcher, async () => true);
    assert.equal(response.status, 404, missing);
  }
});
