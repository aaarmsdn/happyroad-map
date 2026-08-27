import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { directionsByStation, matchingApartmentLinks, priceColor, priceFor, pricePerPyeong, pricePerPyeongFor } from "../public/filter-data.js";
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
});

test("all known Seongsu Lotte Castle Park unit sizes remain selectable", async () => {
  const apartments = JSON.parse(await readFile(new URL("../public/data/apartments.json", import.meta.url), "utf8"));
  const complex = apartments.complexes.find(item => item.id === "8104");
  const links = apartments.links.filter(link => link.complexId === complex.id);
  const complexById = new Map([[complex.id, complex]]);
  const stationDirections = new Map(links.map(link => [link.stationId, new Set(link.directions)]));

  for (const area of ["59", "84", "102", "115"]) {
    const result = matchingApartmentLinks(links, {
      area, distance: 1.5, households: 200, travelTime: null
    }, stationDirections, complexById);
    assert.equal(result.has(complex.id), true, `${area}㎡ filter excluded the complex`);
  }
});

test("empty area selection hides every apartment", () => {
  const result = matchingApartmentLinks(
    [{ complexId: "1", stationId: "s", distanceKm: 0.2 }],
    { area: "", distance: 1, households: 0, travelTime: null },
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
    { area: "전체", distance: 1.5, households: 0, travelTime: null },
    new Map([["in", new Set(["출근"])], ["out", new Set(["퇴근"])]]),
    new Map([["1", { households: 100, areaTags: ["84"] }]])
  );

  assert.equal(result.get("1").distanceKm, 0.4);
  assert.deepEqual(result.get("1").accessDirections, ["출근", "퇴근"]);
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
    { area: "전체", distance: 1.5, households: 0, travelTime: null },
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
  assert.equal(priceFor(prices, { area: "전체" }, "1", "11215"), 150000);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 94000);
  assert.equal(priceFor(prices, { area: "전체", priceMetric: "min" }, "1", "11215"), 60000);
  assert.equal(pricePerPyeongFor(prices, { area: "전체" }, "1", "11215"), 5000);
  assert.equal(pricePerPyeongFor(prices, { area: "전체", priceMetric: "average" }, "1", "11215"), 4000);
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

test("all-area prices include nonstandard area groups", () => {
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
});
