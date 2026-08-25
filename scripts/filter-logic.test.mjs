import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { matchingApartmentLinks, priceColor, pricePerPyeong, pricePerPyeongFor } from "../public/filter-data.js";
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
  const state = { distance: 1.5, households: 200, showStops: true, area: "전체", startHour: "" };
  restoreFilters(state, { distance: "bad", households: -20, showStops: "yes", area: "999", startHour: "5:" });
  assert.deepEqual(state, { distance: 1.5, households: 0, showStops: true, area: "전체", startHour: "" });
});

test("all known Seongsu Lotte Castle Park unit sizes remain selectable", async () => {
  const apartments = JSON.parse(await readFile(new URL("../public/data/apartments.json", import.meta.url), "utf8"));
  const complex = apartments.complexes.find(item => item.id === "8104");
  const links = apartments.links.filter(link => link.complexId === complex.id);
  const complexById = new Map([[complex.id, complex]]);
  const routeNames = new Set(links.flatMap(link => link.routes));

  for (const area of ["59", "84", "102", "115"]) {
    const result = matchingApartmentLinks(links, {
      area, distance: 1.5, households: 200, travelTime: null
    }, routeNames, complexById);
    assert.equal(result.has(complex.id), true, `${area}㎡ filter excluded the complex`);
  }
});

test("apartment colors use median price per pyeong", () => {
  const record = {
    matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "11215",
    medianPerPyeong: 3400,
    areas: {
      "59": { count: 1, median: 60000, medianPerPyeong: 3000 },
      "84": { count: 2, median: 84000, medianPerPyeong: 3500 }
    }
  };
  const prices = { complexes: { "1": record } };
  assert.equal(pricePerPyeong(84000, 84), 3306);
  assert.equal(pricePerPyeongFor(prices, { area: "84" }, "1", "11215"), 3500);
  assert.equal(pricePerPyeongFor(prices, { area: "전체" }, "1", "11215"), 3400);
  delete record.medianPerPyeong;
  assert.equal(pricePerPyeongFor(prices, { area: "전체" }, "1", "11215"), 3500);
  assert.equal(priceColor({ priceColors: true }, 2499), "#18864b");
  assert.equal(priceColor({ priceColors: true }, 2500), "#2774ae");
  assert.equal(priceColor({ priceColors: true }, 4000), "#d6a01d");
  assert.equal(priceColor({ priceColors: true }, 6000), "#f07835");
  assert.equal(priceColor({ priceColors: true }, 8000), "#d83a3a");
});
