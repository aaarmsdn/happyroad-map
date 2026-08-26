import assert from "node:assert/strict";
import test from "node:test";
import { routeRequestForStop } from "../public/filter-data.js";
import { addApartmentMarkers, addRoutePaths, addStopMarkers, spreadMarkerPoints } from "../public/map-view.js";

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

test("coincident cluster summaries receive separate screen positions", () => {
  const points = spreadMarkerPoints([{ x: 10, y: 10 }, { x: 10, y: 10 }], 32, [{ x: 10, y: 10 }]);
  assert.ok(Math.hypot(points[0].x - 10, points[0].y - 10) >= 32);
  assert.ok(Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) >= 32);
});

test("individual map markers keep their source coordinates", () => {
  let placed = [];
  const L = {
    divIcon: options => options,
    marker: latLng => ({
      addTo() { placed.push(latLng); return this; },
      bindTooltip() { return this; },
      getElement() { return null; },
      getLatLng() { return latLng; },
      on() { return this; }
    })
  };
  let zoom = 15;
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => zoom,
    latLngToLayerPoint: () => ({ x: 0, y: 0 }),
    layerPointToLatLng: point => [point.y, point.x]
  };
  const coordinates = [[37.5, 127], [37.513, 127]];
  for (zoom of [13, 15]) {
    placed = [];
    const stops = new Map(coordinates.map(([lat, lng], index) => [String(index), {
      name: `정류장${index}`, lat, lng, entries: [{ routeCategory: "출근", routeName: "노선" }]
    }]));
    const complexes = new Map(coordinates.map(([lat, lng], index) => [String(index), {
      id: String(index), name: `아파트${index}`, lat, lng
    }]));
    addStopMarkers({ L, map, layer: {}, groupedStops: stops, onSelect: () => {} });
    addApartmentMarkers({
      L, map, layer: {}, visibleLinks: new Map([["0", {}], ["1", {}]]), complexById: complexes,
      priceOf: () => null, colorOf: () => "#f04438", onSelect: () => {}
    });
    assert.deepEqual(placed, [...coordinates, ...coordinates], `zoom ${zoom} changed marker coordinates`);
  }
});

test("low-zoom stop cluster summaries avoid exact singleton markers", () => {
  let placed = [];
  const L = {
    divIcon: options => options,
    marker: latLng => ({
      addTo() { placed.push(latLng); return this; },
      bindTooltip() { return this; },
      getElement() { return null; },
      getLatLng() { return latLng; },
      on() { return this; }
    })
  };
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => 13,
    latLngToLayerPoint: ([lat, lng]) => ({ x: lng * 100, y: lat * 100 }),
    layerPointToLatLng: ({ x, y }) => [y / 100, x / 100]
  };
  const coordinates = [[0.01248, 0], [0.01249, 0], [0.01251, 0]];
  const distance = ([left, right]) => {
    const a = map.latLngToLayerPoint(left);
    const b = map.latLngToLayerPoint(right);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const stops = new Map(coordinates.map(([lat, lng], index) => [String(index), {
    name: `정류장${index}`, lat, lng, entries: [{ routeCategory: "출근", routeName: "노선" }]
  }]));
  addStopMarkers({ L, map, layer: {}, groupedStops: stops, onSelect: () => {} });
  assert.ok(distance(placed) >= 42, `stop summary is only ${distance(placed)}px from singleton`);
});

test("apartment clusters use a real complex coordinate and average per-pyeong color", () => {
  const placed = [];
  const icons = [];
  const tooltips = [];
  const colorInputs = [];
  const L = {
    divIcon: options => { icons.push(options.html); return options; },
    marker: latLng => ({
      addTo() { placed.push(latLng); return this; },
      bindTooltip(label) { tooltips.push(label); return this; },
      getElement() { return null; },
      getLatLng() { return latLng; },
      on() { return this; }
    })
  };
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => 13,
    setView() {},
    latLngToLayerPoint: ([lat, lng]) => ({ x: lng * 100, y: lat * 100 })
  };
  const coordinates = [[37.5, 127], [37.501, 127.001], [37.502, 127.002]];
  const complexes = new Map(coordinates.map(([lat, lng], index) => [String(index), {
    id: String(index), name: `아파트${index}`, lat, lng
  }]));
  addApartmentMarkers({
    L, map, layer: {}, visibleLinks: new Map([["0", {}], ["1", {}], ["2", {}]]), complexById: complexes,
    priceOf: () => null,
    perPyeongOf: id => ({ "0": 2000, "1": 4000, "2": 6000 })[id],
    colorOf: value => { colorInputs.push(value); return "#2774ae"; },
    onSelect: () => {}
  });
  assert.deepEqual(placed, [[37.501, 127.001]]);
  assert.deepEqual(colorInputs, [4000]);
  assert.match(icons[0], /--marker-color:#2774ae/);
  assert.equal(tooltips[0], "아파트 3단지 · 평균 평당 4,000만");
});

test("a co-located stop remains the primary pointer target", () => {
  const options = [];
  const L = {
    divIcon: value => value,
    marker: (latLng, markerOptions) => ({
      addTo() { options.push(markerOptions); return this; },
      bindTooltip() { return this; },
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
  const stop = { name: "정류장", lat: 37.5, lng: 127, entries: [{ routeName: "노선", routeCategory: "퇴근" }] };
  const complex = { id: "1", name: "아파트", lat: 37.5, lng: 127 };

  addStopMarkers({ L, map, layer: {}, groupedStops: new Map([["1", stop]]), onSelect: () => {} });
  addApartmentMarkers({
    L, map, layer: {}, visibleLinks: new Map([["1", {}]]), complexById: new Map([["1", complex]]),
    priceOf: () => 10000, colorOf: () => "#f04438", onSelect: () => {}
  });
  assert.ok(options[0].zIndexOffset > options[1].zIndexOffset);
});

test("a co-located apartment remains above a low-zoom stop summary", () => {
  const options = [];
  const L = {
    divIcon: value => value,
    marker: (latLng, markerOptions) => ({
      addTo() { options.push(markerOptions); return this; },
      bindTooltip() { return this; },
      getElement() { return null; },
      getLatLng() { return latLng; },
      on() { return this; }
    })
  };
  const map = {
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getZoom: () => 13,
    latLngToLayerPoint: ([lat, lng]) => ({ x: lng, y: lat }),
    layerPointToLatLng: ({ x, y }) => [y, x]
  };
  const stop = index => ({ name: `정류장${index}`, lat: 37.5, lng: 127, entries: [{ routeName: "노선", routeCategory: "퇴근" }] });
  const complex = { id: "1", name: "아파트", lat: 37.5, lng: 127 };

  addStopMarkers({ L, map, layer: {}, groupedStops: new Map([["1", stop(1)], ["2", stop(2)]]), onSelect: () => {} });
  addApartmentMarkers({
    L, map, layer: {}, visibleLinks: new Map([["1", {}]]), complexById: new Map([["1", complex]]),
    priceOf: () => 10000, colorOf: () => "#f04438", onSelect: () => {}
  });
  assert.ok(options[0].zIndexOffset < options[1].zIndexOffset);
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

test("apartment markers render sub-100-million-won prices in ten-thousand-won units", () => {
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
    L, map, layer: {}, visibleLinks: new Map([["1", {}]]),
    complexById: new Map([["1", { id: "1", name: "단지", lat: 37.5, lng: 127 }]]),
    priceOf: () => 8500,
    perPyeongOf: () => 3306,
    colorOf: value => { colorInputs.push(value); return "#f04438"; },
    onSelect: () => {}
  });
  assert.match(iconHtml.join(""), />8,500만</);
  assert.deepEqual(colorInputs, [3306]);
});

test("dense coincident cluster summaries never overlap", () => {
  const points = spreadMarkerPoints(Array.from({ length: 100 }, () => ({ x: 0, y: 0 })));
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      assert.ok(Math.hypot(points[left].x - points[right].x, points[left].y - points[right].y) >= 32);
    }
  }
});
