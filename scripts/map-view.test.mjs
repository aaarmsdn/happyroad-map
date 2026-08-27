import assert from "node:assert/strict";
import test from "node:test";
import { routeRequestForStop } from "../public/filter-data.js";
import { addApartmentMarkers, addStopMarkers, apartmentDirectionOpacity, stopDirectionIcon } from "../public/map-view.js";
import { addJourneyPaths, addRoutePaths, routeSegmentPoints } from "../public/route-view.js";

function encodePolyline(points) {
  let previousLat = 0;
  let previousLng = 0;
  const encode = value => {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    let output = "";
    while (shifted >= 0x20) { output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63); shifted >>= 5; }
    return output + String.fromCharCode(shifted + 63);
  };
  return points.map(([lat, lng]) => {
    const nextLat = Math.round(lat * 1e5);
    const nextLng = Math.round(lng * 1e5);
    const output = encode(nextLat - previousLat) + encode(nextLng - previousLng);
    previousLat = nextLat;
    previousLng = nextLng;
    return output;
  }).join("");
}

test("stops stay clear and expose their commute direction", () => {
  const inbound = { entries: [{ direction: "출근", routeCategory: "이천->청주" }] };
  const outbound = { entries: [{ direction: "퇴근", routeCategory: "이천->분당" }] };
  const both = { entries: [{ direction: "출근", routeCategory: "기타셔틀" }, { direction: "퇴근", routeCategory: "기타셔틀" }] };
  const other = { entries: [{ routeCategory: "기타셔틀" }] };
  assert.equal(stopDirectionIcon(inbound), "arrow-right");
  assert.equal(stopDirectionIcon(outbound), "arrow-left");
  assert.equal(stopDirectionIcon(both), "arrow-left-right");
  assert.equal(stopDirectionIcon(other), "");
});

test("rendered stop markers keep full opacity and overlay the direction arrow", () => {
  const icons = [];
  const L = {
    divIcon: options => { icons.push(options.html); return options; },
    marker: latLng => ({
      addTo() { return this; }, bindTooltip() { return this; }, getElement() { return null; },
      getLatLng() { return latLng; }, on() { return this; }
    })
  };
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => 15,
    latLngToLayerPoint: () => ({ x: 0, y: 0 })
  };
  const stop = {
    name: "정류장", lat: 37.5, lng: 127,
    entries: [{ direction: "출근", routeCategory: "이천->청주", routeName: "노선" }]
  };
  addStopMarkers({ L, map, layer: {}, groupedStops: new Map([["1", stop]]), onSelect: () => {} });
  assert.match(icons[0], /data-lucide="bus-front"/);
  assert.match(icons[0], /data-lucide="arrow-right"/);
  assert.doesNotMatch(icons[0], /opacity:/);
});

test("all-category apartments are dimmed only when one commute direction is accessible", () => {
  assert.equal(apartmentDirectionOpacity({ accessDirections: ["출근"] }, "전체"), 0.45);
  assert.equal(apartmentDirectionOpacity({ accessDirections: ["퇴근"] }, "전체"), 0.45);
  assert.equal(apartmentDirectionOpacity({ accessDirections: ["출근", "퇴근"] }, "전체"), 1);
  assert.equal(apartmentDirectionOpacity({ accessDirections: [] }, "전체"), 1);
  assert.equal(apartmentDirectionOpacity({ accessDirections: ["출근"] }, "출근"), 1);
});

test("route paths render with a visible halo and highlight without map movement", () => {
  const lines = [];
  const layer = {};
  const L = {
    polyline: (points, options) => ({ addTo(target) { lines.push({ points, options, target }); } })
  };
  const rendered = addRoutePaths({ L, layer, paths: [{ encoded: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }] });
  assert.equal(rendered, 1);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].target, layer);
  assert.deepEqual(lines.map(line => [line.options.color, line.options.weight]), [["#ffffff", 10], ["#7d4cc2", 6]]);
  assert.ok(lines.every(line => line.options.interactive === false));
});

test("journey shuttle paths contain only the boarded segment", () => {
  const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
  assert.deepEqual(routeSegmentPoints(encoded, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }), [
    [40.7, -120.95], [43.252, -126.453]
  ]);
});

test("journey shuttle path follows route stop order at a self-crossing", () => {
  const points = [[0, 0], [1, 1], [2, 2], [1, 1], [2, 0]];
  const stops = [
    { stopOrder: 1, lat: 0, lng: 0 },
    { stopOrder: 2, lat: 1, lng: 1 },
    { stopOrder: 3, lat: 2, lng: 2 },
    { stopOrder: 4, lat: 1, lng: 1 },
    { stopOrder: 5, lat: 2, lng: 0 }
  ];
  assert.deepEqual(routeSegmentPoints(encodePolyline(points), stops[1], stops[3], stops), points.slice(1, 4));
});

test("ordered stop mapping avoids a locally nearest vertex that strands the next stop", () => {
  const points = [[0, 0], [0, 0], [10, 0], [0.1, 0], [20, 0]];
  const stops = [
    { stopOrder: 1, lat: 0.1, lng: 0 },
    { stopOrder: 2, lat: 10, lng: 0 },
    { stopOrder: 3, lat: 20, lng: 0 }
  ];
  assert.deepEqual(routeSegmentPoints(encodePolyline(points), stops[1], stops[2], stops), points.slice(2));
});

test("journey segment rejects a materially distant source geometry endpoint", () => {
  const points = [[37.5, 127], [37.6, 127.1]];
  const start = { stopOrder: 1, lat: 37.45, lng: 126.95 };
  const end = { stopOrder: 2, lat: 37.65, lng: 127.15 };
  assert.deepEqual(routeSegmentPoints(encodePolyline(points), start, end, [start, end]), []);
});

test("journey segment snaps a nearby source geometry endpoint to the stop", () => {
  const points = [[37.5, 127], [37.6, 127.1]];
  const start = { stopOrder: 1, lat: 37.499, lng: 126.999 };
  const end = { stopOrder: 2, lat: 37.601, lng: 127.101 };
  const segment = routeSegmentPoints(encodePolyline(points), start, end, [start, end]);
  assert.deepEqual(segment[0], [start.lat, start.lng]);
  assert.deepEqual(segment.at(-1), [end.lat, end.lng]);
});

test("journey paths use mode color for access and purple for the shuttle segment", () => {
  const lines = [];
  const L = { polyline: (points, options) => ({ addTo() { lines.push({ points, options }); return this; } }) };
  const rendered = addJourneyPaths({
    L, layer: {}, path: { encoded: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
    start: { lat: 38.5, lng: -120.2 }, end: { lat: 43.252, lng: -126.453 },
    accessMode: "public-transit", accessPoints: [[37.5, 127], [37.51, 127.01]],
    accessConnectors: [[[37.49, 126.99], [37.5, 127]]]
  });
  assert.equal(rendered, 3);
  assert.deepEqual(lines.filter(line => line.options.weight === 6).map(line => line.options.color), ["#2774ae", "#7d4cc2"]);
  assert.equal(lines.find(line => line.options.weight === 3).options.dashArray, "5 7");
});

test("a selected stop chooses its first routable entry allowed by every shuttle filter", () => {
  const stop = { entries: [
    { uidKey: "missing", routeName: "경로 없음", routeCategory: "출근", routeType: "통상", time: "06:00", turnStartTime: "06:00", station: "정류장", turnName: "출근" },
    { uidKey: "morning", routeName: "출근 노선", routeCategory: "출근", routeType: "통상", time: "07:00", turnStartTime: "07:00", station: "정류장", turnName: "출근" },
    { uidKey: "evening", routeName: "퇴근 교대", routeCategory: "퇴근", routeType: "교대", time: "18:00", turnStartTime: "18:00", station: "정류장", turnName: "퇴근" },
    { uidKey: "search", routeName: "퇴근 통상", routeCategory: "퇴근", routeType: "통상", time: "19:00", turnStartTime: "19:00", station: "검색대상", turnName: "퇴근" }
  ] };
  const paths = [{ uidKey: "morning" }, { uidKey: "evening" }, { uidKey: "search" }];
  const all = { category: "전체", route: "전체", routeType: "전체", startHour: "", routeQuery: "" };
  const cases = [
    [all, { uidKey: "morning", routeName: "출근 노선" }],
    [{ ...all, category: "퇴근" }, { uidKey: "evening", routeName: "퇴근 교대" }],
    [{ ...all, route: "퇴근 통상" }, { uidKey: "search", routeName: "퇴근 통상" }],
    [{ ...all, category: "퇴근", routeType: "통상" }, { uidKey: "search", routeName: "퇴근 통상" }],
    [{ ...all, startHour: "18" }, { uidKey: "evening", routeName: "퇴근 교대" }],
    [{ ...all, routeQuery: "검색대상" }, { uidKey: "search", routeName: "퇴근 통상" }]
  ];
  for (const [state, expected] of cases) assert.deepEqual(routeRequestForStop(stop, paths, state), expected);
});

test("apartment markers render prices and one-direction opacity", () => {
  const iconHtml = [];
  const colorInputs = [];
  const L = {
    divIcon: options => { iconHtml.push(options.html); return options; },
    marker: latLng => ({
      addTo() { return this; },
      bindTooltip() { return this; },
      getElement() { return null; },
      getLatLng() { return latLng; },
      on() { return this; }
    })
  };
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => 15,
    latLngToLayerPoint: () => ({ x: 0, y: 0 }),
    layerPointToLatLng: () => [37.5, 127]
  };
  addApartmentMarkers({
    L, map, layer: {}, category: "전체", visibleLinks: new Map([["1", { accessDirections: ["출근"] }]]),
    complexById: new Map([["1", { id: "1", name: "단지", lat: 37.5, lng: 127 }]]),
    priceOf: () => 8500,
    perPyeongOf: () => 3306,
    colorOf: value => { colorInputs.push(value); return "#f04438"; },
    onSelect: () => {}
  });
  assert.match(iconHtml.join(""), />8,500만</);
  assert.match(iconHtml.join(""), /opacity:0\.45/);
  assert.deepEqual(colorInputs, [3306]);
});

test("apartment markers expose per-pyeong prices when selected areas have no trades", () => {
  const tooltips = [];
  const L = {
    divIcon: options => options,
    marker: latLng => ({
      addTo() { return this; },
      bindTooltip(label) { tooltips.push(label); return this; },
      getElement() { return null; },
      getLatLng() { return latLng; },
      on() { return this; }
    })
  };
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => 15,
    latLngToLayerPoint: () => ({ x: 0, y: 0 })
  };
  addApartmentMarkers({
    L, map, layer: {}, visibleLinks: new Map([["1", {}]]),
    complexById: new Map([["1", { id: "1", name: "단지", lat: 37.5, lng: 127 }]]),
    priceOf: () => null, perPyeongOf: () => 4474, colorOf: () => "#d6a01d", onSelect: () => {}
  });
  assert.equal(tooltips[0], "단지 · 평당 4,474만");
});
