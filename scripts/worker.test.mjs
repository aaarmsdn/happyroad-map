import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleRequest } from "../worker/src/index.js";
import { routeResult } from "../worker/src/normalize.js";

const env = { KAKAO_REST_API_KEY: "secret", SHUTTLE_ESTIMATE_TOKEN: "estimate-secret", ALLOWED_ORIGIN: "https://aaarmsdn.github.io", ROUTE_RATE_LIMITER: { limit: async () => ({ success: true }) } };

function futureDepartureStamp(hours = 36) {
  const kst = new Date(Date.now() + hours * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  return [kst.getUTCFullYear(), kst.getUTCMonth() + 1, kst.getUTCDate(), kst.getUTCHours(), kst.getUTCMinutes()]
    .map((value, index) => String(value).padStart(index ? 2 : 4, "0")).join("");
}

test("route fares use only the field for the requested transport mode", () => {
  const start = { lat: 37.5, lng: 127 };
  const end = { lat: 37.499, lng: 127.001 };
  const transit = routeResult({ routes: [{
    properties: { totalTime: 300, totalDistance: 150, fare: { value: 1550, taxi: 8700 } },
    steps: [{
      properties: { type: "BUS", time: 300, stops: [{ name: "출발" }, { name: "도착" }], vehicles: [{ name: "간선버스" }] },
      path: { points: [[127, 37.5], [127.001, 37.499]] }
    }]
  }] }, "public-transit", start, end);
  const car = routeResult({ routes: [{
    summary: { duration: 300, distance: 150, fare: { value: 1550, taxi: 8700 } },
    sections: [{
      roads: [{ vertexes: [127, 37.5, 127.001, 37.499] }],
      guides: [{ name: "직진", duration: 300, distance: 150 }]
    }]
  }] }, "car", start, end);
  assert.equal(transit.fare, 1550);
  assert.equal(car.fare, 8700);
});

test("route distance falls back to measured geometry", () => {
  const start = { lat: 37.5, lng: 127 };
  const end = { lat: 37.499, lng: 127.001 };
  const route = routeResult({ routes: [{
    properties: { totalTime: 600 },
    steps: [{
      properties: { type: "WALK", time: 600 },
      path: { points: [[127, 37.5], [127.001, 37.499]] }
    }]
  }] }, "walk", start, end);
  assert.ok(route.distanceMeters > 100);
});

test("worker answers browser preflight without a response body", async () => {
  const response = await handleRequest(new Request("https://worker.test/route", { method: "OPTIONS", headers: { origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("worker rejects an untrusted browser origin", async () => {
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", { headers: { origin: "https://evil.example" } }), env, async () => new Response());
  assert.equal(response.status, 403);
});

test("worker accepts the local preview origin", async () => {
  const localOrigin = "http://127.0.0.1:8766";
  const localEnv = { ...env, ALLOWED_ORIGIN: `${env.ALLOWED_ORIGIN},${localOrigin}` };
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", { headers: { origin: localOrigin } }), localEnv, async () => Response.json({ documents: [] }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), localOrigin);
});

test("worker returns 429 when Cloudflare rate limit is exhausted", async () => {
  const limitedEnv = { ...env, ROUTE_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", { headers: { origin: env.ALLOWED_ORIGIN } }), limitedEnv);
  assert.equal(response.status, 429);
});

test("worker fails closed when the Cloudflare rate limiter is missing", async () => {
  const { ROUTE_RATE_LIMITER, ...missingLimiterEnv } = env;
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", {
    headers: { origin: env.ALLOWED_ORIGIN }
  }), missingLimiterEnv);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "rate_limiter_unavailable" });
});

test("worker rejects route coordinates outside Korea", async () => {
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 35.68, lng: 139.69 }, end: { lat: 37.5, lng: 127 }, mode: "public-transit" })
  }), env, async () => new Response());
  assert.equal(response.status, 400);
});

test("worker rejects nearby foreign and North Korean coordinates", async () => {
  for (const start of [{ lat: 33.59, lng: 130.4 }, { lat: 34.65598, lng: 129.46947 }, { lat: 37.68902, lng: 125.08658 }, { lat: 37.7156143973, lng: 125.6529861385 }, { lat: 38.0575, lng: 124.82028 }, { lat: 39.04, lng: 125.76 }, { lat: 37.97, lng: 126.55 }]) {
    const response = await handleRequest(new Request("https://worker.test/route", {
      method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ start, end: { lat: 37.5, lng: 127 }, mode: "public-transit" })
    }), env, async () => new Response());
    assert.equal(response.status, 400);
  }
});

test("worker accepts mainland coordinates through the northern edge", async () => {
  for (const start of [{ lat: 37.34, lng: 127.92 }, { lat: 37.889, lng: 126.740 }, { lat: 37.898, lng: 126.709 }]) {
    const response = await handleRequest(new Request("https://worker.test/route", {
      method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ start, end: { lat: start.lat + 0.001, lng: start.lng + 0.001 }, mode: "walk" })
    }), env, async () => new Response());
    assert.equal(response.status, 404);
  }
});

test("worker accepts South Korean island coordinates", async () => {
  for (const start of [
    { lat: 37.72, lng: 126.42 }, { lat: 37.97, lng: 124.66 }, { lat: 37.66, lng: 125.70 },
    { lat: 37.83, lng: 124.70 }, { lat: 37.76, lng: 124.74 }, { lat: 34.68, lng: 125.19 },
    { lat: 33.95, lng: 126.30 }, { lat: 34.68, lng: 125.43 }, { lat: 34.05, lng: 125.12 },
    { lat: 35.0912, lng: 129.0678 }, { lat: 35.0525, lng: 129.087 }, { lat: 37.386, lng: 126.419 },
    { lat: 37.19, lng: 126.31 }, { lat: 37.535, lng: 126.34 }
  ]) {
    let routeCalled = false;
    const response = await handleRequest(new Request("https://worker.test/route", {
      method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ start, end: { lat: start.lat + 0.001, lng: start.lng + 0.001 }, mode: "walk" })
    }), env, async () => { routeCalled = true; return Response.json({ route: null }); });
    assert.equal(response.status, 404);
    assert.equal(routeCalled, true);
  }
});

test("worker keeps nationwide place results and asks Kakao for twelve", async () => {
  let upstream;
  const response = await handleRequest(new Request("https://worker.test/places?q=부산역", { headers: { origin: env.ALLOWED_ORIGIN } }), env, async url => {
    upstream = String(url);
    return Response.json({ documents: [{ place_name: "부산역", address_name: "부산 동구", y: "35.115", x: "129.041" }] });
  });
  assert.match(upstream, /[?&]size=12(?:&|$)/);
  assert.deepEqual(await response.json(), [{ name: "부산역", address: "부산 동구", lat: 35.115, lng: 129.041 }]);
});

test("worker returns a compact road address for a map coordinate", async () => {
  let upstream;
  const response = await handleRequest(new Request("https://worker.test/address?lat=37.5446&lng=127.056", { headers: { origin: env.ALLOWED_ORIGIN } }), env, async url => {
    upstream = String(url);
    return Response.json({ documents: [{
      address: { region_3depth_name: "성수동1가", main_address_no: "676", sub_address_no: "5", mountain_yn: "N" },
      road_address: { region_1depth_name: "서울", region_2depth_name: "성동구", road_name: "성수일로", main_building_no: "12", sub_building_no: "3" }
    }] });
  });
  assert.match(upstream, /\/v2\/local\/geo\/coord2address\.json/);
  assert.deepEqual(await response.json(), { address: "서울 성동구 성수일로 12-3", parcelIdentity: "성수동1가|676-5" });
});

test("transit geometry may omit a one-kilometer connector while walk geometry stays strict", () => {
  const start = { lat: 37.5, lng: 127 };
  const end = { lat: 37.51, lng: 127.01 };
  const payload = { routes: [{
    properties: { totalTime: 600, totalDistance: 2000 },
    steps: [{ properties: { type: "BUS", time: 600, stops: [{ name: "A" }, { name: "B" }], vehicles: [{ name: "버스" }] }, path: { points: [[127.012, 37.5], [127.01, 37.51]] } }]
  }] };
  assert.ok(routeResult(payload, "public-transit", start, end));
  assert.equal(routeResult({ route: payload.routes[0] }, "walk", start, end), null);
});

test("worker disables caching for location responses and Kakao requests", async () => {
  let options;
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", {
    headers: { origin: env.ALLOWED_ORIGIN }
  }), env, async (_url, nextOptions) => {
    options = nextOptions;
    return Response.json({ documents: [] });
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
});

test("worker rejects oversized Kakao responses before parsing", async () => {
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", {
    headers: { origin: env.ALLOWED_ORIGIN }
  }), env, async () => new Response("x".repeat(2_000_001), {
    headers: { "content-type": "application/json", "content-length": "2000001" }
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream_unavailable" });
});

test("worker rejects oversized route responses before parsing", async () => {
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.501, lng: 127.001 }, mode: "walk" })
  }), env, async () => new Response("x".repeat(425_001), {
    headers: { "content-type": "application/json", "content-length": "425001" }
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream_unavailable" });
});

test("worker accepts a valid route response below the route size limit", async () => {
  const pointCount = 10_500;
  const points = Array.from({ length: pointCount }, (_, index) => [127 + index / (pointCount - 1) * 0.1, 37.5 + index / (pointCount - 1) * 0.1]);
  const payload = JSON.stringify({
    route: {
      properties: { totalTime: 600, totalDistance: 15_000 },
      steps: [{ properties: { time: 600, distance: 15_000, guidance: "도보" }, path: { points } }]
    }
  });
  assert.ok(payload.length > 400_000 && payload.length < 425_000, payload.length);
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.6, lng: 127.1 }, mode: "walk" })
  }), env, async () => new Response(payload, { headers: { "content-length": String(payload.length) } }));
  assert.equal(response.status, 200);
});

test("worker cancels a headerless route stream at the route size limit", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(128_000));
      if (pulls === 20) controller.close();
    },
    cancel() { cancelled = true; }
  });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.501, lng: 127.001 }, mode: "walk" })
  }), env, async () => new Response(stream, { headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 5, pulls);
});

test("worker samples large transit and car geometries to five hundred points", async () => {
  const start = { lat: 37.5, lng: 127 };
  const end = { lat: 37.6, lng: 127.1 };
  const points = Array.from({ length: 10_000 }, (_, index) => [127 + index / 99_990, 37.5 + index / 99_990]);
  const modes = {
    "public-transit": {
      route: {
        properties: { totalTime: 600, totalDistance: 15_000 },
        steps: [{ properties: { type: "bus", time: 600, distance: 15_000, guidance: "버스 이동" }, path: { points } }]
      }
    },
    car: {
      routes: [{
        summary: { duration: 600, distance: 15_000 },
        sections: [{ roads: [{ vertexes: points.flat() }], guides: [] }]
      }]
    }
  };
  for (const [mode, payload] of Object.entries(modes)) {
    const response = await handleRequest(new Request("https://worker.test/route", {
      method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ start, end, mode })
    }), env, async () => Response.json(payload));
    assert.equal(response.status, 200, mode);
    const result = await response.json();
    assert.equal(result.points.length, 500, mode);
    assert.deepEqual(result.points[0], [start.lat, start.lng], mode);
    assert.deepEqual(result.points.at(-1), [end.lat, end.lng], mode);
  }
});

test("worker cancels a headerless Kakao stream at the response size limit", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(256_000));
      if (pulls === 30) controller.close();
    },
    cancel() { cancelled = true; }
  });
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", {
    headers: { origin: env.ALLOWED_ORIGIN }
  }), env, async () => new Response(stream, { headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
  assert.ok(pulls < 30);
});

test("worker rejects route bodies over 1 KB in UTF-8 bytes", async () => {
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ padding: "가".repeat(400) })
  }), env, async () => new Response());
  assert.equal(response.status, 400);
});

test("worker keeps the Kakao key in the outbound authorization header", async () => {
  let upstream;
  const fetcher = async (url, options) => {
    upstream = { url: String(url), options };
    return Response.json({ documents: [{ place_name: "강남역", address_name: "서울 강남구", y: "37.49", x: "127.02" }] });
  };
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", { headers: { origin: env.ALLOWED_ORIGIN } }), env, fetcher);
  assert.equal(response.status, 200);
  assert.equal(upstream.options.headers.Authorization, "KakaoAK secret");
  assert.doesNotMatch(await response.text(), /secret/);
});

test("worker sends a string URL to the Cloudflare fetch runtime", async () => {
  const fetcher = async url => {
    assert.equal(typeof url, "string");
    return Response.json({ documents: [] });
  };
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", { headers: { origin: env.ALLOWED_ORIGIN } }), env, fetcher);
  assert.equal(response.status, 200);
});

test("Cloudflare ExecutionContext is not used as the upstream fetch function", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ documents: [] });
  try {
    const response = await worker.fetch(
      new Request("https://worker.test/places?q=강남", { headers: { origin: env.ALLOWED_ORIGIN } }),
      env,
      { waitUntil() {} }
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker exposes only the Kakao status and numeric error code", async () => {
  const fetcher = async () => Response.json({ code: -401, msg: "contains upstream details" }, { status: 401 });
  const response = await handleRequest(new Request("https://worker.test/places?q=강남", { headers: { origin: env.ALLOWED_ORIGIN } }), env, fetcher);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "kakao_upstream", status: 401, code: -401 });
});

test("worker normalizes a Kakao public transit response", async () => {
  const fetcher = async () => Response.json({ routes: [{
    properties: { totalTime: 1500, totalDistance: 5200, transfers: 1, fare: { value: 1550 } },
    steps: [
      { properties: { type: "WALKING", time: 300, distance: 350, guidance: "성수역까지 도보" }, path: { points: [[127, 37.5], [127.01, 37.51]] } },
      { properties: { type: "SUBWAY", time: 900, distance: 4300, stops: [{ name: "성수역" }, { name: "강남역" }], vehicles: [{ name: "2호선" }] }, path: { points: [[127.01, 37.51], [127.1, 37.4]] } }
    ]
  }] });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "public-transit" })
  }), env, fetcher);
  assert.deepEqual(await response.json(), {
    minutes: 25, transfers: 1, fare: 1550, distanceMeters: 5200,
    points: [[37.5, 127], [37.51, 127.01], [37.4, 127.1]],
    steps: [
      { type: "walk", guidance: "성수역까지 도보", minutes: 5, distanceMeters: 350 },
      { type: "subway", guidance: "2호선 · 성수역 → 강남역", minutes: 15, distanceMeters: 4300, vehicle: "2호선", startStop: "성수역", endStop: "강남역", stopCount: 2 },
      { type: "walk", guidance: "환승·승하차 및 연결 이동", minutes: 5, distanceMeters: 0 }
    ]
  });
});

test("worker charges one rate-limit unit per batched upstream route", async () => {
  let limitCalls = 0;
  const batchEnv = { ...env, ROUTE_RATE_LIMITER: { limit: async () => { limitCalls += 1; return { success: true }; } } };
  const fetcher = async url => {
    const requestUrl = new URL(url);
    const start = [Number(requestUrl.searchParams.get("start_x")), Number(requestUrl.searchParams.get("start_y"))];
    const end = [Number(requestUrl.searchParams.get("end_x")), Number(requestUrl.searchParams.get("end_y"))];
    return Response.json({ route: {
      properties: { totalTime: 600, totalDistance: 1000 },
      steps: [{ properties: { time: 600, distance: 1000, guidance: "이동" }, path: { points: [start, end] } }]
    } });
  };
  const response = await handleRequest(new Request("https://worker.test/routes", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ routes: [
      { id: 0, start: { lat: 37.5, lng: 127 }, end: { lat: 37.51, lng: 127.01 }, mode: "walk" },
      { id: 1, start: { lat: 37.5, lng: 127 }, end: { lat: 37.51, lng: 127.01 }, mode: "walk" }
    ] })
  }), batchEnv, fetcher);
  assert.equal(response.status, 200);
  assert.equal(limitCalls, 2);
  assert.equal((await response.json()).routes.length, 2);
});

test("worker reports a batch-wide upstream failure", async () => {
  const response = await handleRequest(new Request("https://worker.test/routes", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ routes: [{
      id: 0, start: { lat: 37.5, lng: 127 }, end: { lat: 37.51, lng: 127.01 }, mode: "walk"
    }] })
  }), env, async () => { throw new Error("network"); });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream_unavailable" });
});

test("worker accepts 27 routes and rejects 28", async () => {
  const makeRoutes = count => Array.from({ length: count }, (_, id) => ({
    id, start: { lat: 37.5, lng: 127 }, end: { lat: 37.501, lng: 127.001 }, mode: "walk"
  }));
  const fetcher = async url => {
    const parsed = new URL(url);
    const start = [Number(parsed.searchParams.get("start_x")), Number(parsed.searchParams.get("start_y"))];
    const end = [Number(parsed.searchParams.get("end_x")), Number(parsed.searchParams.get("end_y"))];
    return Response.json({ route: {
      properties: { totalTime: 600, totalDistance: 150 },
      steps: [{ properties: { time: 600, distance: 150, guidance: "도보" }, path: { points: [start, end] } }]
    } });
  };
  const request = routes => new Request("https://worker.test/routes", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ routes })
  });
  assert.equal((await handleRequest(request(makeRoutes(27)), env, fetcher)).status, 200);
  assert.equal((await handleRequest(request(makeRoutes(28)), env, fetcher)).status, 400);
});

test("worker preserves successful routes in a partially failed batch", async () => {
  let call = 0;
  const response = await handleRequest(new Request("https://worker.test/routes", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ routes: [0, 1].map(id => ({
      id, start: { lat: 37.5, lng: 127 }, end: { lat: 37.501, lng: 127.001 }, mode: "walk"
    })) })
  }), env, async url => {
    if (call++ === 0) throw new Error("network");
    const parsed = new URL(url);
    const points = [
      [Number(parsed.searchParams.get("start_x")), Number(parsed.searchParams.get("start_y"))],
      [Number(parsed.searchParams.get("end_x")), Number(parsed.searchParams.get("end_y"))]
    ];
    return Response.json({ route: {
      properties: { totalTime: 600, totalDistance: 150 },
      steps: [{ properties: { time: 600, distance: 150, guidance: "도보" }, path: { points } }]
    } });
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.routes[0].route, null);
  assert.equal(payload.routes[1].route.minutes, 10);
});

test("worker rejects public transit responses without concrete steps", async () => {
  const fetcher = async () => Response.json({ routes: [{
    properties: { totalTime: 900, totalDistance: 1100 }
  }] });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "public-transit" })
  }), env, fetcher);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "route_not_found" });
});

test("worker rejects malformed nonempty public transit steps", async () => {
  const fetcher = async () => Response.json({ routes: [{
    properties: { totalTime: 900, totalDistance: 1100 }, steps: [{}]
  }] });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "public-transit" })
  }), env, fetcher);
  assert.equal(response.status, 404);
});

test("worker normalizes Kakao walking response with a singular route", async () => {
  const fetcher = async () => Response.json({ route: {
    properties: { totalTime: 900, totalDistance: 1100 },
    steps: [{ properties: { time: 900, distance: 1100, guidance: "횡단보도를 건너 직진" }, path: { points: [[127, 37.5], [127.1, 37.4]] } }]
  } });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "walk" })
  }), env, fetcher);
  assert.deepEqual(await response.json(), {
    minutes: 15, transfers: 0, fare: 0, distanceMeters: 1100,
    points: [[37.5, 127], [37.4, 127.1]],
    steps: [{ type: "walk", guidance: "횡단보도를 건너 직진", minutes: 15, distanceMeters: 1100 }]
  });
});

test("worker keeps detailed step minutes equal to the route total", async () => {
  const fetcher = async () => Response.json({ route: {
    properties: { totalTime: 60, totalDistance: 20 },
    steps: [
      { properties: { time: 1, distance: 10, guidance: "첫 이동" }, path: { points: [[127, 37.5], [127.01, 37.49]] } },
      { properties: { time: 1, distance: 10, guidance: "둘째 이동" }, path: { points: [[127.01, 37.49], [127.1, 37.4]] } }
    ]
  } });
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "walk" })
  }), env, fetcher);
  const route = await response.json();
  assert.equal(route.minutes, 1);
  assert.equal(route.steps.reduce((sum, step) => sum + step.minutes, 0), route.minutes);
});

test("worker requests Kakao Mobility directions for a car route", async () => {
  let upstream;
  const fetcher = async url => {
    upstream = String(url);
    return Response.json({ routes: [{
      summary: { duration: 780, distance: 4500, fare: { taxi: 8700 } },
      sections: [{
        roads: [{ name: "테헤란로", distance: 4500, duration: 780, vertexes: [127, 37.5, 127.05, 37.45, 127.1, 37.4] }],
        guides: [{ name: "테헤란로 진입", distance: 120, duration: 30 }]
      }]
    }] });
  };
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "car" })
  }), env, fetcher);
  assert.match(upstream, /^https:\/\/apis-navi\.kakaomobility\.com\/v1\/directions\?/);
  assert.match(upstream, /summary=false/);
  assert.deepEqual(await response.json(), {
    minutes: 13, transfers: 0, fare: 8700, distanceMeters: 4500,
    points: [[37.5, 127], [37.45, 127.05], [37.4, 127.1]],
    steps: [{ type: "car", guidance: "테헤란로 진입", minutes: 13, distanceMeters: 120 }]
  });
});

test("worker requests future car directions at a supplied shuttle departure time", async () => {
  let upstream;
  const departureTime = futureDepartureStamp();
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json", "x-happyroad-estimate-token": env.SHUTTLE_ESTIMATE_TOKEN },
    body: JSON.stringify({
      start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "car", departureTime
    })
  }), env, async url => {
    upstream = String(url);
    return Response.json({ routes: [{
      summary: { duration: 600, distance: 4000 },
      sections: [{ roads: [{ vertexes: [127, 37.5, 127.1, 37.4] }], guides: [] }]
    }] });
  });
  assert.equal(response.status, 200);
  assert.match(upstream, /^https:\/\/apis-navi\.kakaomobility\.com\/v1\/future\/directions\?/);
  assert.match(upstream, new RegExp(`departure_time=${departureTime}`));
});

test("worker protects future car routes with a private token", async () => {
  const response = await handleRequest(new Request("https://worker.test/route", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "car", departureTime: futureDepartureStamp()
    })
  }), env, async () => Response.json({}));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden_future_route" });
});

test("worker rejects impossible, past, and distant future departure times", async () => {
  for (const departureTime of ["202602300000", "200001010000", futureDepartureStamp(8 * 24)]) {
    const response = await handleRequest(new Request("https://worker.test/route", {
      method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json", "x-happyroad-estimate-token": env.SHUTTLE_ESTIMATE_TOKEN },
      body: JSON.stringify({
        start: { lat: 37.5, lng: 127 }, end: { lat: 37.4, lng: 127.1 }, mode: "car", departureTime
      })
    }), env, async () => Response.json({}));
    assert.equal(response.status, 400);
  }
});
