import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { routeSegmentPoints, routeSegmentSourcePoints } from "../public/route-view.js";

const distanceKm = (point, stop) => {
  const radians = Math.PI / 180;
  const latitude = (point[0] + stop.lat) * radians / 2;
  const north = (point[0] - stop.lat) * 111.195;
  const east = (point[1] - stop.lng) * 111.195 * Math.cos(latitude);
  return Math.hypot(north, east);
};

test("real shuttle segments never bridge a source geometry gap over 500 meters", async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-data.js", import.meta.url), "utf8"), { window });
  const shuttle = window.HAPPYROAD_MAP_DATA;
  const paths = new Map(shuttle.paths.map(path => [path.uidKey, path]));
  const groups = new Map();
  for (const entry of shuttle.entries) {
    if (!groups.has(entry.uidKey)) groups.set(entry.uidKey, []);
    groups.get(entry.uidKey).push(entry);
  }

  let inspected = 0;
  let rejected = 0;
  for (const [uidKey, entries] of groups) {
    const path = paths.get(uidKey);
    const company = entries.find(entry => entry.isCompany);
    if (!path || !company) continue;
    for (const stop of entries.filter(entry => !entry.isCompany)) {
      const inbound = stop.direction === "출근";
      const start = inbound ? stop : company;
      const end = inbound ? company : stop;
      const source = routeSegmentSourcePoints(path.encoded, start, end, entries);
      if (!source.length) continue;
      const gap = Math.max(distanceKm(source[0], start), distanceKm(source.at(-1), end));
      const rendered = routeSegmentPoints(path.encoded, start, end, entries);
      inspected += 1;
      if (gap > 0.5) {
        rejected += 1;
        assert.deepEqual(rendered, [], `${stop.routeName} must not bridge ${gap.toFixed(3)} km`);
      } else {
        assert.ok(rendered.length >= 2, `${stop.routeName} lost valid geometry`);
      }
    }
  }

  assert.ok(inspected > 6000);
  assert.ok(rejected > 0);
});

test("generated estimates fill every missing shuttle duration without changing source data", async () => {
  const window = {};
  const context = { window };
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-data.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-time-estimates.js", import.meta.url), "utf8"), context);
  const missing = window.HAPPYROAD_MAP_DATA.entries.filter(entry => {
    const field = entry.direction === "출근" ? "minutesToCompany" : entry.direction === "퇴근" ? "minutesFromCompany" : null;
    return field && (entry[field] === null || entry[field] === "" || entry[field] === undefined);
  });
  const gongdeok = window.HAPPYROAD_MAP_DATA.entries.find(entry => entry.routeName === "신길선" && entry.station === "공덕역 7번출구");

  assert.equal(window.HAPPYROAD_SHUTTLE_TIME_ESTIMATES.count, 190);
  assert.equal(missing.length, 0);
  assert.equal(gongdeok.turnName, "통상 18시퇴근");
  assert.equal(gongdeok.timeEstimated, true);
  assert.ok(gongdeok.minutesFromCompany > 120);
});

test("generated estimates never overwrite an authoritative shuttle duration", async () => {
  const window = {};
  const context = { window };
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-data.js", import.meta.url), "utf8"), context);
  const source = await readFile(new URL("../public/data/shuttle-time-estimates.js", import.meta.url), "utf8");
  const [payloadSource, applySource] = source.trim().split("\n");
  vm.runInNewContext(payloadSource, context);
  const estimateKey = Object.keys(window.HAPPYROAD_SHUTTLE_TIME_ESTIMATES.estimates)[0];
  const [turnUid, stopOrder, stationUid] = estimateKey.split(":");
  const entry = window.HAPPYROAD_MAP_DATA.entries.find(item => item.turnUid === turnUid && String(item.stopOrder) === stopOrder && item.stationUid === stationUid);
  const field = entry.direction === "출근" ? "minutesToCompany" : "minutesFromCompany";
  entry[field] = 7;
  entry.time = "12:34";
  entry.sourceTimeText = "원본 시간";
  vm.runInNewContext(applySource, context);
  assert.equal(entry[field], 7);
  assert.equal(entry.time, "12:34");
  assert.equal(entry.sourceTimeText, "원본 시간");

  entry[field] = null;
  vm.runInNewContext(applySource, context);
  assert.ok(entry[field] > 0);
  assert.equal(entry.time, "12:34");
  assert.equal(entry.sourceTimeText, "원본 시간");
  assert.equal(entry.timeEstimated, undefined);
});
