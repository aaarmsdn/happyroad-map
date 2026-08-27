import assert from "node:assert/strict";
import test from "node:test";
import { accessRoutesFor, findShuttleCandidates, formatShuttleTime, isKoreaPoint, nearestShuttleStops, nextFiveMinuteValue, recommendCommuteJourneys } from "../public/commute-routing.js";

const entries = [
  { uidKey: "in-1", routeName: "아침선", routeCategory: "출근", stopOrder: 1, station: "A", lat: 37.5, lng: 127, time: "07:00", minutesToCompany: 60 },
  { uidKey: "in-1", routeName: "아침선", routeCategory: "출근", stopOrder: 2, station: "회사", lat: 37.25, lng: 127.48, time: "08:00", isCompany: true, minutesToCompany: 0 },
  { uidKey: "out-1", routeName: "저녁선", routeCategory: "퇴근", stopOrder: 1, station: "회사", lat: 37.25, lng: 127.48, time: "18:00", isCompany: true, minutesFromCompany: 0 },
  { uidKey: "out-1", routeName: "저녁선", routeCategory: "퇴근", stopOrder: 2, station: "B", lat: 37.51, lng: 127.01, time: "19:00", minutesFromCompany: 60 }
];

test("company-bound search uses selected point and catches a reachable shuttle", () => {
  const routes = findShuttleCandidates({
    entries, mode: "to-company", point: { lat: 37.5, lng: 127 },
    departureAt: new Date("2026-08-26T06:30:00+09:00"), accessMinutesByStop: new Map([["A", 20]])
  });
  assert.equal(routes[0].uidKey, "in-1");
  assert.equal(routes[0].shuttleAt, "07:00");
  assert.equal(routes[0].arrivalAt, "08:00");
  assert.equal(routes[0].totalMinutes, 90);
});

test("home-bound search rejects a shuttle that left before selected departure", () => {
  const routes = findShuttleCandidates({
    entries, mode: "from-company", point: { lat: 37.51, lng: 127.01 },
    departureAt: new Date("2026-08-26T18:10:00+09:00"), accessMinutesByStop: new Map([["B", 10]])
  });
  assert.deepEqual(routes, []);
});

test("company-bound search handles a shuttle after midnight", () => {
  const overnight = [
    { uidKey: "night-in", routeName: "심야선", routeCategory: "출근", stopOrder: 1, station: "N", time: "00:10", minutesToCompany: 50 },
    { uidKey: "night-in", routeName: "심야선", routeCategory: "출근", stopOrder: 2, station: "회사", time: "01:00", isCompany: true, minutesToCompany: 0 }
  ];
  const routes = findShuttleCandidates({
    entries: overnight, mode: "to-company", point: { lat: 37.5, lng: 127 },
    departureAt: new Date("2026-08-26T23:50:00+09:00"), accessMinutesByStop: new Map([["N", 5]])
  });
  assert.equal(routes[0].shuttleAt, "00:10");
  assert.equal(routes[0].arrivalAt, "01:00");
  assert.equal(routes[0].totalMinutes, 70);
});

test("company-bound search keeps the next morning shuttle beyond twelve hours", () => {
  const nextMorning = [
    { uidKey: "next-in", routeName: "다음날선", routeCategory: "출근", stopOrder: 1, station: "N", time: "07:30" },
    { uidKey: "next-in", routeName: "다음날선", routeCategory: "출근", stopOrder: 2, station: "회사", time: "08:30", isCompany: true }
  ];
  const routes = findShuttleCandidates({
    entries: nextMorning, mode: "to-company", point: { lat: 37.5, lng: 127 },
    departureAt: new Date("2026-08-26T19:00:00+09:00"), accessMinutesByStop: new Map([["N", 5]])
  });
  assert.equal(routes[0].shuttleAt, "07:30");
});

test("company-bound search rejects a shuttle almost one day away", () => {
  const nextDay = [
    { uidKey: "departed-in", routeName: "이미 출발", routeCategory: "출근", stopOrder: 1, station: "N", lat: 37.5, lng: 127, time: "05:32" },
    { uidKey: "departed-in", routeName: "이미 출발", routeCategory: "출근", stopOrder: 2, station: "회사", time: "06:44", isCompany: true }
  ];
  const departureAt = new Date("2026-08-28T06:00:00+09:00");
  assert.deepEqual(findShuttleCandidates({
    entries: nextDay, mode: "to-company", point: { lat: 37.5, lng: 127 }, departureAt,
    accessMinutesByStop: new Map([["N", 5]])
  }), []);
  assert.deepEqual(nearestShuttleStops(nextDay, "to-company", { lat: 37.5, lng: 127 }, 5, departureAt), []);
});

test("Korea coordinate check accepts nationwide cities and rejects overseas points", () => {
  for (const point of [
    { lat: 37.5, lng: 127 }, { lat: 37.889, lng: 126.740 }, { lat: 37.898, lng: 126.709 },
    { lat: 35.1796, lng: 129.0756 }, { lat: 35.0912, lng: 129.0678 }, { lat: 35.0525, lng: 129.087 },
    { lat: 37.386, lng: 126.419 }, { lat: 37.19, lng: 126.31 }, { lat: 37.535, lng: 126.34 },
    { lat: 33.4996, lng: 126.5312 },
    { lat: 36.35, lng: 127.38 }, { lat: 37.484, lng: 130.905 }, { lat: 37.72, lng: 126.42 },
    { lat: 37.97, lng: 124.66 }, { lat: 37.66, lng: 125.70 }, { lat: 37.83, lng: 124.70 },
    { lat: 37.76, lng: 124.74 }, { lat: 34.68, lng: 125.19 }, { lat: 33.95, lng: 126.30 },
    { lat: 34.68, lng: 125.43 }, { lat: 34.05, lng: 125.12 }
  ]) assert.equal(isKoreaPoint(point), true);
  for (const point of [{ lat: 35.68, lng: 139.69 }, { lat: 33.59, lng: 130.4 }, { lat: 34.65598, lng: 129.46947 }, { lat: 37.68902, lng: 125.08658 }, { lat: 37.7156143973, lng: 125.6529861385 }, { lat: 38.0575, lng: 124.82028 }, { lat: 39.04, lng: 125.76 }, { lat: 37.97, lng: 126.55 }]) assert.equal(isKoreaPoint(point), false);
});

test("commute routing follows direction when route category is a regional shuttle", () => {
  const regional = [
    { uidKey: "regional", routeName: "청주선", routeCategory: "이천->청주", direction: "퇴근", stopOrder: 1, station: "회사", time: "18:00", isCompany: true },
    { uidKey: "regional", routeName: "청주선", routeCategory: "이천->청주", direction: "퇴근", stopOrder: 2, station: "오창", lat: 36.71, lng: 127.43, time: "19:00" }
  ];
  const routes = findShuttleCandidates({
    entries: regional, mode: "from-company", point: { lat: 36.71, lng: 127.43 },
    departureAt: new Date("2026-08-26T17:50:00+09:00"), accessMinutesByStop: new Map([["오창", 5]])
  });
  assert.equal(routes[0].uidKey, "regional");
});

test("out-of-region access does not create estimated fallback journeys", async () => {
  let calls = 0;
  const routes = await accessRoutesFor({
    stops: [{ key: "A", lat: 37.5, lng: 127, distanceKm: 1 }],
    direction: "to-company", point: { lat: 35.68, lng: 139.69 }, apiBase: "https://worker.test",
    fetcher: async () => { calls += 1; return Response.json({ minutes: 10 }); }
  });
  assert.equal(calls, 0);
  assert.deepEqual([...routes.values()].map(value => value.size), [0, 0, 0]);
});

test("out-of-region shuttle stops do not create estimated fallback journeys", async () => {
  let calls = 0;
  const routes = await accessRoutesFor({
    stops: [{ key: "outside", lat: 35.68, lng: 139.69, distanceKm: 100 }],
    direction: "to-company", point: { lat: 37.5, lng: 127 }, apiBase: "https://worker.test",
    fetcher: async () => { calls += 1; return Response.json({ minutes: 10 }); }
  });
  assert.equal(calls, 0);
  assert.deepEqual([...routes.values()].map(value => value.size), [0, 0, 0]);
});

test("failed route API calls do not create geometry-less recommendation cards", async () => {
  await assert.rejects(() => accessRoutesFor({
    stops: [{ key: "A", lat: 37.51, lng: 127.01, distanceKm: 1 }],
    direction: "to-company", point: { lat: 37.5, lng: 127 }, apiBase: "https://worker.test",
    fetcher: async () => new Response(null, { status: 503 })
  }), /route_api_unavailable/);
});

test("successful route responses without drawable geometry do not create recommendation cards", async () => {
  const invalidPoints = [[], [[37.5, 127], [37.5, 127]], [[null, null], [37.51, 127.01]], [[91, 127], [37.51, 127.01]], [[37.7, 127.7], [37.71, 127.71]]];
  for (const points of invalidPoints) {
    const routes = await accessRoutesFor({
      stops: [{ key: "A", lat: 37.51, lng: 127.01, distanceKm: 1 }],
      direction: "to-company", point: { lat: 37.5, lng: 127 }, apiBase: "https://worker.test",
      fetcher: async (_url, options) => Response.json({ routes: JSON.parse(options.body).routes.map(request => ({
        id: request.id, route: { minutes: 10, points }
      })) })
    });
    assert.deepEqual([...routes.values()].map(value => value.size), [0, 0, 0], JSON.stringify(points));
  }
});

test("client accepts public transit connector gaps while keeping walk and car strict", async () => {
  const calls = [];
  const routes = await accessRoutesFor({
    stops: [{ key: "A", lat: 37.51, lng: 127.01, distanceKm: 1 }],
    direction: "to-company", point: { lat: 37.5, lng: 127 }, apiBase: "https://worker.test",
    fetcher: async (_url, options) => {
      const requests = JSON.parse(options.body).routes;
      calls.push(...requests.map(request => request.mode));
      return Response.json({ routes: requests.map(request => ({
        id: request.id,
        route: { minutes: 10, points: [[37.5, 127.012], [37.51, 127.01]] }
      })) });
    }
  });
  assert.equal(routes.get("public-transit").has("A"), true);
  assert.deepEqual(routes.get("public-transit").get("A").connectors, [[[37.5, 127], [37.5, 127.012]]]);
  assert.equal(routes.get("walk").has("A"), false);
  assert.equal(routes.get("car").has("A"), false);
  assert.deepEqual(calls.sort(), ["car", "public-transit", "walk"]);
});

test("walk and public transit check twelve shuttle stops while car remains capped", async () => {
  const calls = { walk: 0, car: 0, "public-transit": 0 };
  let workerCalls = 0;
  const stops = Array.from({ length: 12 }, (_, index) => ({ key: String(index), lat: 37.5 + index * 0.001, lng: 127, distanceKm: index }));
  await accessRoutesFor({
    stops, direction: "to-company", point: { lat: 37.5, lng: 127 }, apiBase: "https://worker.test",
    fetcher: async (url, options) => {
      workerCalls += 1;
      assert.equal(url, "https://worker.test/routes");
      const requests = JSON.parse(options.body).routes;
      requests.forEach(request => { calls[request.mode] += 1; });
      return Response.json({ routes: requests.map(request => ({
        id: request.id,
        route: { minutes: 10, distanceMeters: 1000, points: [[request.start.lat, request.start.lng], [request.end.lat, request.end.lng]] }
      })) });
    }
  });
  assert.equal(workerCalls, 1);
  assert.deepEqual(calls, { walk: 12, car: 3, "public-transit": 12 });
});

test("walking recommendation breaks equal total times by shorter walking time", () => {
  const tied = [
    { uidKey: "long-walk", routeName: "빠른 셔틀", routeCategory: "퇴근", stopOrder: 1, station: "회사", time: "18:00", isCompany: true },
    { uidKey: "long-walk", routeName: "빠른 셔틀", routeCategory: "퇴근", stopOrder: 2, station: "긴 도보", time: "18:40" },
    { uidKey: "short-walk", routeName: "느린 셔틀", routeCategory: "퇴근", stopOrder: 1, station: "회사", time: "18:00", isCompany: true },
    { uidKey: "short-walk", routeName: "느린 셔틀", routeCategory: "퇴근", stopOrder: 2, station: "짧은 도보", time: "18:50" }
  ];
  const routes = recommendCommuteJourneys({
    entries: tied, mode: "from-company", point: { lat: 37.5, lng: 127 }, departureAt: new Date("2026-08-26T18:00:00+09:00"),
    accessMinutesByMode: new Map([["walk", new Map([["긴 도보", { minutes: 20 }], ["짧은 도보", { minutes: 10 }]])]])
  });
  assert.equal(routes[0].station, "짧은 도보");
});

test("walking recommendations prefer at most 1.2 kilometers over an earlier long walk", () => {
  const entries = [
    { uidKey: "long", routeName: "빠른 장거리", routeCategory: "출근", stopOrder: 1, station: "긴 도보", time: "07:00", minutesToCompany: 40 },
    { uidKey: "long", routeName: "빠른 장거리", routeCategory: "출근", stopOrder: 2, station: "회사", time: "07:40", isCompany: true },
    { uidKey: "short", routeName: "늦은 단거리", routeCategory: "출근", stopOrder: 1, station: "짧은 도보", time: "07:10", minutesToCompany: 40 },
    { uidKey: "short", routeName: "늦은 단거리", routeCategory: "출근", stopOrder: 2, station: "회사", time: "07:50", isCompany: true }
  ];
  const routes = recommendCommuteJourneys({
    entries, mode: "to-company", point: { lat: 37.5, lng: 127 }, departureAt: new Date("2026-08-28T06:00:00+09:00"),
    accessMinutesByMode: new Map([["walk", new Map([
      ["긴 도보", { minutes: 10, distanceMeters: 1201 }],
      ["짧은 도보", { minutes: 10, distanceMeters: 1200 }]
    ])]])
  });
  assert.equal(routes[0].station, "짧은 도보");
});

test("walking preference is applied before candidate truncation", () => {
  const longEntries = Array.from({ length: 21 }, (_, index) => [
    { uidKey: `long-${index}`, routeName: `빠른 장거리 ${index}`, routeCategory: "출근", stopOrder: 1, station: `긴 도보 ${index}`, time: "07:00", minutesToCompany: 40 },
    { uidKey: `long-${index}`, routeName: `빠른 장거리 ${index}`, routeCategory: "출근", stopOrder: 2, station: "회사", time: "07:40", isCompany: true }
  ]).flat();
  const entries = [...longEntries,
    { uidKey: "short", routeName: "늦은 단거리", routeCategory: "출근", stopOrder: 1, station: "짧은 도보", time: "07:10", minutesToCompany: 40 },
    { uidKey: "short", routeName: "늦은 단거리", routeCategory: "출근", stopOrder: 2, station: "회사", time: "07:50", isCompany: true }
  ];
  const walkRoutes = new Map(longEntries.filter(entry => !entry.isCompany).map(entry => [entry.station, { minutes: 10, distanceMeters: 1201 }]));
  walkRoutes.set("짧은 도보", { minutes: 10, distanceMeters: 1200 });

  const routes = recommendCommuteJourneys({
    entries, mode: "to-company", point: { lat: 37.5, lng: 127 }, departureAt: new Date("2026-08-28T06:00:00+09:00"),
    accessMinutesByMode: new Map([["walk", walkRoutes]])
  });
  assert.equal(routes[0].station, "짧은 도보");
});

test("walk and car reject missing endpoint segments while transit keeps its connector", async () => {
  for (const direction of ["to-company", "from-company"]) {
    const routes = await accessRoutesFor({
      stops: [{ key: "A", lat: 37.51, lng: 127, distanceKm: 1 }],
      direction, point: { lat: 37.5, lng: 127 }, apiBase: "https://worker.test",
      fetcher: async (_url, options) => {
        const requests = JSON.parse(options.body).routes;
        return Response.json({ routes: requests.map(request => ({
          id: request.id,
          route: {
            minutes: 10,
            points: direction === "to-company"
              ? [[request.start.lat + 0.008, request.start.lng], [request.end.lat, request.end.lng]]
              : [[request.start.lat, request.start.lng], [request.end.lat + 0.008, request.end.lng]]
          }
        })) });
      }
    });
    assert.deepEqual([...routes.values()].map(value => value.size), [0, 0, 1], direction);
  }
});

test("nearest stop selection removes routes that already left before applying distance", () => {
  const scheduled = [
    { uidKey: "past", routeCategory: "출근", stopOrder: 1, station: "가까운 과거", lat: 37.5, lng: 127, time: "17:00" },
    { uidKey: "past", routeCategory: "출근", stopOrder: 2, station: "회사", lat: 37.25, lng: 127.48, time: "18:00", isCompany: true },
    { uidKey: "future", routeCategory: "출근", stopOrder: 1, station: "조금 먼 예정", lat: 37.51, lng: 127, time: "18:00" },
    { uidKey: "future", routeCategory: "출근", stopOrder: 2, station: "회사", lat: 37.25, lng: 127.48, time: "19:00", isCompany: true }
  ];
  const stops = nearestShuttleStops(scheduled, "to-company", { lat: 37.5, lng: 127 }, 1, new Date("2026-08-26T17:30:00+09:00"));
  assert.equal(stops[0].station, "조금 먼 예정");
});

test("nearest stop selection skips inbound stops that cannot be reached before departure", () => {
  const scheduled = [
    ...Array.from({ length: 5 }, (_, index) => [
      { uidKey: `too-soon-${index}`, routeCategory: "출근", stopOrder: 1, station: `가까운 임박 ${index}`, lat: 37.5, lng: 127 + index * 0.0001, time: "07:01" },
      { uidKey: `too-soon-${index}`, routeCategory: "출근", stopOrder: 2, station: "회사", lat: 37.25, lng: 127.48, time: "08:00", isCompany: true }
    ]).flat(),
    { uidKey: "reachable", routeCategory: "출근", stopOrder: 1, station: "도달 가능", lat: 37.51, lng: 127, time: "08:00" },
    { uidKey: "reachable", routeCategory: "출근", stopOrder: 2, station: "회사", lat: 37.25, lng: 127.48, time: "09:00", isCompany: true }
  ];
  const stops = nearestShuttleStops(scheduled, "to-company", { lat: 37.5, lng: 127 }, 5, new Date("2026-08-26T07:00:00+09:00"));
  assert.deepEqual(stops.map(stop => stop.station), ["도달 가능"]);
});

test("nearest stop selection skips outbound stops without arrival times", () => {
  const scheduled = [
    { uidKey: "missing-arrival", routeCategory: "퇴근", stopOrder: 1, station: "회사", lat: 37.25, lng: 127.48, time: "18:00", isCompany: true },
    { uidKey: "missing-arrival", routeCategory: "퇴근", stopOrder: 2, station: "가까운 시간 없음", lat: 37.5, lng: 127 },
    { uidKey: "valid-arrival", routeCategory: "퇴근", stopOrder: 1, station: "회사", lat: 37.25, lng: 127.48, time: "18:00", isCompany: true },
    { uidKey: "valid-arrival", routeCategory: "퇴근", stopOrder: 2, station: "도착시간 있음", lat: 37.51, lng: 127, time: "19:00" }
  ];
  const stops = nearestShuttleStops(scheduled, "from-company", { lat: 37.5, lng: 127 }, 1, new Date("2026-08-26T17:30:00+09:00"));
  assert.equal(stops[0].station, "도착시간 있음");
});

test("departure input rounds up to the next five minutes", () => {
  assert.equal(nextFiveMinuteValue(new Date("2026-08-26T06:31:10+09:00")), "2026-08-26T06:35");
  assert.equal(nextFiveMinuteValue(new Date("2026-08-26T06:30:10+09:00")), "2026-08-26T06:35");
});

test("single-digit shuttle times display without trailing seconds", () => {
  assert.equal(formatShuttleTime("7:26:04"), "07:26");
});

test("commute recommendations contain walk, taxi, then three transit options", () => {
  const manyEntries = [1, 2, 3].flatMap(index => [
    { uidKey: `in-${index}`, routeName: `아침선 ${index}`, routeCategory: "출근", stopOrder: 1, station: `S${index}`, lat: 37.5, lng: 127, time: `07:0${index}` },
    { uidKey: `in-${index}`, routeName: `아침선 ${index}`, routeCategory: "출근", stopOrder: 2, station: "회사", lat: 37.25, lng: 127.48, time: `08:0${index}`, isCompany: true }
  ]);
  const minutes = new Map([["S1", 10], ["S2", 12], ["S3", 14]]);
  const routes = recommendCommuteJourneys({
    entries: manyEntries,
    mode: "to-company",
    point: { lat: 37.5, lng: 127 },
    departureAt: new Date("2026-08-26T06:30:00+09:00"),
    accessMinutesByMode: new Map([["car", minutes], ["public-transit", minutes], ["walk", minutes]])
  });
  assert.deepEqual(routes.map(route => route.accessMode), ["walk", "car", "public-transit", "public-transit", "public-transit"]);
});

test("commute recommendations skip a faster shuttle without valid geometry", () => {
  const candidates = [1, 2].flatMap(index => [
    { uidKey: `route-${index}`, routeName: `노선 ${index}`, routeCategory: "출근", stopOrder: 1, station: `S${index}`, time: `07:0${index}` },
    { uidKey: `route-${index}`, routeName: `노선 ${index}`, routeCategory: "출근", stopOrder: 2, station: "회사", time: `08:0${index}`, isCompany: true }
  ]);
  const routes = recommendCommuteJourneys({
    entries: candidates, mode: "to-company", point: { lat: 37.5, lng: 127 },
    departureAt: new Date("2026-08-26T06:30:00+09:00"),
    accessMinutesByMode: new Map([["walk", new Map([["S1", 5], ["S2", 10]])]]),
    acceptJourney: journey => journey.uidKey === "route-2"
  });
  assert.deepEqual(routes.map(route => route.uidKey), ["route-2"]);
});

test("company-bound recommendations separate access, wait and shuttle minutes", () => {
  const accessRoute = {
    minutes: 10, estimated: false, points: [[37.5, 127], [37.501, 127.001]],
    steps: [{ type: "walk", guidance: "정류장까지 이동", minutes: 10, distanceMeters: 700 }]
  };
  const routes = recommendCommuteJourneys({
    entries, mode: "to-company", point: { lat: 37.5, lng: 127 },
    departureAt: new Date("2026-08-26T06:30:00+09:00"),
    accessMinutesByMode: new Map([["walk", new Map([["A", accessRoute]])]])
  });
  assert.deepEqual(
    { access: routes[0].accessMinutes, wait: routes[0].waitMinutes, shuttle: routes[0].shuttleMinutes, total: routes[0].totalMinutes },
    { access: 10, wait: 20, shuttle: 60, total: 90 }
  );
  assert.equal(routes[0].accessRoute, accessRoute);
});

test("home-bound recommendations separate company wait, shuttle and final access", () => {
  const routes = recommendCommuteJourneys({
    entries, mode: "from-company", point: { lat: 37.51, lng: 127.01 },
    departureAt: new Date("2026-08-26T17:30:00+09:00"),
    accessMinutesByMode: new Map([["car", new Map([["B", { minutes: 12, estimated: false }]])]])
  });
  assert.deepEqual(
    { access: routes[0].accessMinutes, wait: routes[0].waitMinutes, shuttle: routes[0].shuttleMinutes, total: routes[0].totalMinutes },
    { access: 12, wait: 30, shuttle: 60, total: 102 }
  );
});
