import assert from "node:assert/strict";
import test from "node:test";
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
