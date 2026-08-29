import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apartmentColor, apartmentCommuteTimes, apartmentLinkTimings, apartmentRoundTripMinutes, directionsByStation, matchingApartmentLinks, priceColor, priceFor, pricePerPyeong, pricePerPyeongFor } from "../public/filter-data.js";
import { hourOf, restoreFilters, routeTypeOptions, selectGlobalRoute } from "../public/filter-logic.js";

test("single-digit shuttle hours are normalized", () => {
  assert.equal(hourOf("5:30"), "05");
  assert.equal(hourOf("18:00"), "18");
  assert.equal(hourOf(""), "");
});

test("route type options contain one all option", () => {
  assert.deepEqual(routeTypeOptions(["전체", "통상", "교대"]), ["전체", "통상", "교대"]);
});

test("global route search clears incompatible shuttle scope", () => {
  const state = { category: "출근", route: "전체", routeType: "교대", startHour: "05", routeQuery: "오산", area: "84" };
  selectGlobalRoute(state, "18시 오창퇴근");
  assert.deepEqual(state, { category: "전체", route: "18시 오창퇴근", routeType: "전체", startHour: "", routeQuery: "", area: "84" });
});

test("persisted filters reject wrong types and clamp numeric ranges", () => {
  const state = { distance: 1.5, households: 200, showStops: true, area: "전체", startHour: "", priceMetric: "max" };
  restoreFilters(state, { distance: "bad", households: -20, showStops: "yes", area: "999", startHour: "5:", priceMetric: "median" });
  assert.deepEqual(state, { distance: 1.5, households: 0, showStops: true, area: "전체", startHour: "", priceMetric: "max" });
  restoreFilters(state, { priceMetric: "average" });
  assert.equal(state.priceMetric, "average");
  restoreFilters(state, { area: "70-79" });
  assert.equal(state.area, "70-79");
});

test("persisted school visibility remains opt-in but restores an explicit choice", () => {
  const state = { showSchools: false };
  restoreFilters(state, { showSchools: true });
  assert.equal(state.showSchools, true);
  restoreFilters(state, { showSchools: "yes" });
  assert.equal(state.showSchools, true);
});

test("all known Seongsu Lotte Castle Park area ranges remain selectable", async () => {
  const apartments = JSON.parse(await readFile(new URL("../public/data/apartments.json", import.meta.url), "utf8"));
  const complex = apartments.complexes.find(item => item.id === "8104");
  const links = apartments.links.filter(link => link.complexId === complex.id);
  const complexById = new Map([[complex.id, complex]]);
  const stationDirections = new Map(links.map(link => [link.stationId, new Set(link.directions)]));

  for (const area of ["59-69", "80-89", "100-109", "110-120"]) {
    const result = matchingApartmentLinks(links, {
      area, distance: 1.5, households: 200, inboundTime: null, outboundTime: null
    }, stationDirections, complexById);
    assert.equal(result.has(complex.id), true, `${area}㎡ filter excluded the complex`);
  }
});

test("empty area selection hides every apartment", () => {
  const result = matchingApartmentLinks(
    [{ complexId: "1", stationId: "s", distanceKm: 0.2 }],
    { area: "", distance: 1, households: 0, inboundTime: null, outboundTime: null },
    new Map([["s", new Set(["출근"])]]),
    new Map([["1", { households: 100, areaTags: ["84"] }]])
  );
  assert.equal(result.size, 0);
});

test("apartment links retain every accessible commute direction while choosing the nearest stop", () => {
  const links = [
    { complexId: "1", stationId: "in", distanceKm: 0.8, travelMinutes: 12, routes: ["출근 노선"], directions: ["출근"] },
    { complexId: "1", stationId: "out", distanceKm: 0.4, travelMinutes: 8, routes: ["퇴근 노선"], directions: ["퇴근"] }
  ];
  const result = matchingApartmentLinks(
    links,
    { area: "전체", distance: 1.5, households: 0, inboundTime: null, outboundTime: null },
    new Map([["in", new Set(["출근"])], ["out", new Set(["퇴근"])]]),
    new Map([["1", { households: 100, areaTags: ["84"] }]])
  );

  assert.equal(result.get("1").distanceKm, 0.4);
  assert.deepEqual(result.get("1").accessDirections, ["출근", "퇴근"]);
});

test("apartment round trip independently chooses the fastest normal stop in each direction", () => {
  const links = [
    { stationId: "near", distanceKm: 0.4 },
    { stationId: "far", distanceKm: 0.8 }
  ];
  const stations = new Map([
    ["near", { entries: [
      { routeCategory: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 80 },
      { routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 70 }
    ] }],
    ["far", { entries: [
      { routeCategory: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 55 },
      { routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 85 }
    ] }]
  ]);
  assert.equal(apartmentRoundTripMinutes(links, stations, 1.5), 140);
  assert.equal(apartmentRoundTripMinutes(links, new Map([["near", { entries: stations.get("near").entries.slice(0, 1) }]]), 1.5), null);
});

test("apartment round trip falls back to the closest standard clock when normal runs are absent", () => {
  const links = [{ stationId: "fallback", distanceKm: 0.4 }];
  const stations = new Map([["fallback", { entries: [
    { direction: "출근", turnName: "특수 출근", companyTime: "08:10", minutesToCompany: 60 },
    { direction: "퇴근", turnName: "통상 19시퇴근", companyTime: "19:00", minutesFromCompany: 70 }
  ] }]]);
  assert.equal(apartmentRoundTripMinutes(links, stations), 140);
});

test("apartment commute totals expose shuttle and optional walking time per direction", async () => {
  const module = await import("../public/filter-data.js");
  assert.equal(typeof module.apartmentCommuteTimes, "function");
  const links = [
    { stationId: "in", distanceKm: 0.72 },
    { stationId: "out", distanceKm: 1.04 }
  ];
  const stations = new Map([
    ["in", { entries: [{ routeCategory: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 55 }] }],
    ["out", { entries: [{ routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 39 }] }]
  ]);

  assert.deepEqual(module.apartmentCommuteTimes(links, stations, 1.5, true), {
    inbound: { shuttleMinutes: 55, walkingMinutes: 9, totalMinutes: 64, stationId: "in" },
    outbound: { shuttleMinutes: 39, walkingMinutes: 13, totalMinutes: 52, stationId: "out" },
    roundTripMinutes: 116
  });
  assert.deepEqual(module.apartmentCommuteTimes(links, stations, 1.5, false), {
    inbound: { shuttleMinutes: 55, walkingMinutes: 0, totalMinutes: 55, stationId: "in" },
    outbound: { shuttleMinutes: 39, walkingMinutes: 0, totalMinutes: 39, stationId: "out" },
    roundTripMinutes: 94
  });
});

test("apartment commute ignores opposite-direction routes sharing a station id", () => {
  const links = [
    { stationId: "inbound-side", distanceKm: 0.2, routes: ["출근선"], directions: ["출근"] },
    { stationId: "outbound-side", distanceKm: 0.3, routes: ["퇴근선"], directions: ["퇴근"] },
    { stationId: "late-outbound", distanceKm: 0.1, routes: ["심야퇴근선"], directions: ["퇴근"] }
  ];
  const stations = new Map([
    ["inbound-side", { entries: [
      { routeName: "출근선", direction: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 55 },
      { routeName: "심야퇴근선", direction: "퇴근", turnName: "통상 22시퇴근", companyTime: "22:00", minutesFromCompany: 40 }
    ] }],
    ["outbound-side", { entries: [
      { routeName: "퇴근선", direction: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 70 }
    ] }],
    ["late-outbound", { entries: [
      { routeName: "심야퇴근선", direction: "퇴근", turnName: "통상 22시퇴근", companyTime: "22:00", minutesFromCompany: 40 }
    ] }]
  ]);

  assert.deepEqual(apartmentLinkTimings(links[0], stations), {
    inboundMinutes: 55, outboundMinutes: null,
    inboundStopAt: "07:05", inboundCompanyAt: "08:00", outboundCompanyAt: null, outboundStopAt: null,
    fallbackLabel: ""
  });
  assert.deepEqual(apartmentCommuteTimes(links, stations, 1.5, false), {
    inbound: { shuttleMinutes: 55, walkingMinutes: 0, totalMinutes: 55, stationId: "inbound-side" },
    outbound: { shuttleMinutes: 70, walkingMinutes: 0, totalMinutes: 70, stationId: "outbound-side" },
    roundTripMinutes: 125
  });
});

test("apartment filters use representative inbound and outbound times instead of stale link summaries", () => {
  const links = [{ complexId: "1", stationId: "both", distanceKm: 0.8, travelMinutes: 10 }];
  const stations = new Map([["both", { entries: [
    { routeCategory: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 55 },
    { routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 70 }
  ] }]]);
  const stationDirections = new Map([["both", new Set(["출근", "퇴근"])]]);
  const complexes = new Map([["1", { households: 100, areaTags: ["84"] }]]);
  const base = { area: "전체", distance: 1.5, households: 0, inboundTime: null, outboundTime: null, includeWalking: false };

  assert.equal(matchingApartmentLinks(links, { ...base, inboundTime: 50 }, stationDirections, complexes, stations).has("1"), false);
  assert.equal(matchingApartmentLinks(links, { ...base, inboundTime: 55, outboundTime: 70 }, stationDirections, complexes, stations).has("1"), true);
  assert.equal(matchingApartmentLinks(links, { ...base, outboundTime: 65 }, stationDirections, complexes, stations).has("1"), false);
  assert.equal(matchingApartmentLinks(links, { ...base, inboundTime: 60, includeWalking: true }, stationDirections, complexes, stations).has("1"), false);
});

test("apartment time filters ignore stations outside the active shuttle scope", () => {
  const links = [
    { complexId: "1", stationId: "active", distanceKm: 0.2 },
    { complexId: "1", stationId: "filtered-out", distanceKm: 0.3 }
  ];
  const stations = new Map([
    ["active", { entries: [{ routeCategory: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 90 }] }],
    ["filtered-out", { entries: [{ routeCategory: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 40 }] }]
  ]);
  const result = matchingApartmentLinks(
    links,
    { area: "전체", distance: 1.5, households: 0, inboundTime: 60, outboundTime: null, includeWalking: false },
    new Map([["active", new Set(["출근"])]]),
    new Map([["1", { households: 100, areaTags: ["84"] }]]),
    stations
  );
  assert.equal(result.has("1"), false);
});

test("apartment time filters ignore inactive directions at an active station", () => {
  const inbound = { stationUid: "shared", routeCategory: "출근", direction: "출근", turnName: "통상 출근", companyTime: "08:00", minutesToCompany: 55 };
  const outbound = { stationUid: "shared", routeCategory: "퇴근", direction: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 70 };
  const result = matchingApartmentLinks(
    [{ complexId: "1", stationId: "shared", distanceKm: 0.2 }],
    { area: "전체", distance: 1.5, households: 0, inboundTime: null, outboundTime: 80, includeWalking: false },
    new Map([["shared", new Set(["출근"])]]),
    new Map([["1", { households: 100, areaTags: ["84"] }]]),
    new Map([["shared", { entries: [inbound, outbound] }]]),
    [inbound]
  );
  assert.equal(result.has("1"), false);
});

test("commute source stations are promoted ahead of nearer unrelated links", async () => {
  const module = await import("../public/filter-data.js");
  assert.equal(typeof module.prioritizeCommuteLinks, "function");
  const links = [
    { stationId: "near", distanceKm: 0.1 },
    { stationId: "inbound", distanceKm: 1.0 },
    { stationId: "outbound", distanceKm: 1.2 }
  ];
  const commute = { inbound: { stationId: "inbound" }, outbound: { stationId: "outbound" } };
  assert.deepEqual(module.prioritizeCommuteLinks(links, commute).map(link => link.stationId), ["inbound", "outbound", "near"]);
});

test("apartment color supports price, round-trip time, and plain modes", () => {
  assert.equal(apartmentColor({ apartmentColor: "commute" }, 9000, 119), "#18864b");
  assert.equal(apartmentColor({ apartmentColor: "commute" }, 9000, 120), "#2774ae");
  assert.equal(apartmentColor({ apartmentColor: "commute" }, 9000, 150), "#d6a01d");
  assert.equal(apartmentColor({ apartmentColor: "commute" }, 9000, 180), "#f07835");
  assert.equal(apartmentColor({ apartmentColor: "commute" }, 9000, 240), "#d83a3a");
  assert.equal(apartmentColor({ apartmentColor: "commute" }, 9000, null), "#63717a");
  assert.equal(apartmentColor({ apartmentColor: "price" }, 9000, 60), "#d83a3a");
  assert.equal(apartmentColor({ apartmentColor: "price" }, null, 60), "#63717a");
  assert.equal(apartmentColor({ apartmentColor: "none" }, 9000, 60), "#f04438");
  assert.equal(apartmentColor({ apartmentColor: "commute" }, null, 60), "#63717a");
  assert.equal(apartmentColor({ apartmentColor: "none" }, null, 60), "#63717a");
});

test("apartment directions follow filtered station entries instead of unrelated route directions", () => {
  const links = [{
    complexId: "1", stationId: "shared", distanceKm: 0.2, travelMinutes: 5,
    routes: ["공용 노선"], directions: ["출근", "퇴근"]
  }];
  const stationDirections = directionsByStation([
    { stationUid: "shared", routeName: "공용 노선", routeCategory: "기타셔틀", direction: "출근" }
  ]);
  const result = matchingApartmentLinks(
    links,
    { area: "전체", distance: 1.5, households: 0, inboundTime: null, outboundTime: null },
    stationDirections,
    new Map([["1", { households: 100, areaTags: ["84"] }]])
  );
  assert.deepEqual(result.get("1").accessDirections, ["출근"]);
});

test("apartment prices default to highest and support highest, average, and lowest", () => {
  const record = {
    matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "11215",
    min: 60000, average: 94000, median: 90000, max: 150000,
    minPerPyeong: 3000, averagePerPyeong: 4000, medianPerPyeong: 3900, maxPerPyeong: 5000,
    areas: {
      "59": { count: 1, min: 60000, average: 60000, median: 60000, max: 60000, minPerPyeong: 3000, averagePerPyeong: 3000, medianPerPyeong: 3000, maxPerPyeong: 3000 },
      "84": { count: 3, min: 80000, average: 100000, median: 95000, max: 120000, minPerPyeong: 3150, averagePerPyeong: 3950, medianPerPyeong: 3750, maxPerPyeong: 4700 }
    }
  };
  const prices = { complexes: { "1": record } };
  assert.equal(pricePerPyeong(84000, 84), 3306);
  assert.equal(priceFor(prices, { area: "84" }, "1", "11215"), 120000);
  assert.equal(priceFor(prices, { area: "84", priceMetric: "average" }, "1", "11215"), 100000);
  assert.equal(priceFor(prices, { area: "84", priceMetric: "min" }, "1", "11215"), 80000);
  assert.equal(priceFor(prices, { area: "전체" }, "1", "11215"), 120000);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 100000);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "min" }, "1", "11215"), 80000);
  assert.equal(pricePerPyeongFor(prices, { area: "전체" }, "1", "11215"), 4700);
  assert.equal(pricePerPyeongFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 3950);
  assert.equal(pricePerPyeongFor(prices, { area: "84", priceMetric: "min" }, "1", "11215"), 3150);
  assert.equal(priceColor({ priceColors: true }, 2499), "#18864b");
  assert.equal(priceColor({ priceColors: true }, 2500), "#2774ae");
  assert.equal(priceColor({ priceColors: true }, 4000), "#d6a01d");
  assert.equal(priceColor({ priceColors: true }, 6000), "#f07835");
  assert.equal(priceColor({ priceColors: true }, 8000), "#d83a3a");
});

test("legacy summaries never label medians as arithmetic averages", () => {
  const prices = { complexes: { "1": {
    matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "11215",
    medianPerPyeong: 3900,
    areas: { "84": { count: 3, min: 80000, median: 95000, max: 120000, medianPerPyeong: 3750 } }
  } } };
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), null);
  assert.equal(priceFor(prices, { area: "84", priceMetric: "average" }, "1", "11215"), null);
  assert.equal(pricePerPyeongFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), null);
});

test("all-area prices choose the highest target area when 84 is unavailable", () => {
  const prices = { complexes: { "1": {
    matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "11215",
    areas: {
      "59": { count: 1, average: 80000, max: 90000, averagePerPyeong: 4483, maxPerPyeong: 5043 },
      "102": { count: 2, average: 70000, max: 140000, averagePerPyeong: 2269, maxPerPyeong: 4538 },
      "115": { count: 1, average: 75000, max: 130000, averagePerPyeong: 2157, maxPerPyeong: 3739 }
    }
  } } };
  assert.equal(priceFor(prices, { area: "전체" }, "1", "11215"), 140000);
  assert.equal(pricePerPyeongFor(prices, { area: "전체" }, "1", "11215"), 4538);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 70000);
  assert.equal(pricePerPyeongFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 2269);
});

test("all-area prices include every 59-to-120 area group", () => {
  const prices = { complexes: { "1": {
    matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "11215",
    areas: {
      "76": { count: 2, min: 70000, average: 80000, max: 90000, minPerPyeong: 3045, averagePerPyeong: 3480, maxPerPyeong: 3915 }
    }
  } } };
  assert.equal(priceFor(prices, { area: "전체" }, "1", "11215"), 90000);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 80000);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "min" }, "1", "11215"), 70000);
  assert.equal(pricePerPyeongFor(prices, { area: "전체" }, "1", "11215"), 3915);
  assert.equal(priceFor(prices, { area: "70-79" }, "1", "11215"), 90000);
});
