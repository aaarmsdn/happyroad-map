import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { applyMonthly, applyServiceWeekdays } from "./import-shuttle-monthly.mjs";
import { findShuttleCandidates } from "../public/commute-routing.js";

const entry = (stationUid, stopOrder, direction, isCompany = false) => ({ routeUid: "r", turnUid: "t", uidKey: "r|t", stationUid, stopOrder, direction, isCompany, durationBucket: "unknown", color: "#999", durationGroup: "소요시간 없음" });
const average = (stationUid, value) => ({ routeUid: "r", turnUid: "t", stationUid, busOrder: 1, sampleDays: value === null ? 0 : 21, meanServiceSeconds: value });
function apply(entries, averages, start) {
  const data = { entries, paths: [{ turnUid: "t" }], source: {} };
  applyMonthly(data, averages, new Map([["t", { beginStationDepartureTime: start, stations: [{ uid: entries[0].stationUid }] }]]), new Map(), { from: "2026-08-16", through: "2026-09-15" });
  return data;
}

test("monthly import anchors inbound origin and outbound departure without losing midnight", () => {
  const inbound = apply([entry("origin", 1, "출근"), entry("company", 2, "출근", true)], [average("origin", 19898), average("company", 25230)], "05:33");
  assert.equal(inbound.entries[0].time, "05:33:00");
  assert.equal(inbound.entries[1].time, "07:00:30");
  assert.equal(inbound.entries[0].minutesToCompany, 88);
  assert.equal(inbound.paths[0].turnStartTime, "05:33:00");
  const outbound = apply([entry("company", 1, "퇴근", true), entry("stop", 2, "퇴근")], [average("company", 83700), average("stop", 87000)], "23:20");
  assert.equal(outbound.entries[0].time, "23:20:00");
  assert.equal(outbound.entries[1].time, "00:10:00");
  assert.equal(outbound.entries[1].minutesFromCompany, 50);
  assert.equal(outbound.entries[1].companyTime, "23:20:00");
});

test("missing and pre-departure averages cannot become synthetic routing candidates", () => {
  for (const value of [null, 64700]) {
    const data = apply([entry("company", 1, "퇴근", true), entry("stop", 2, "퇴근")], [average("stop", value)], "18:00");
    assert.equal(data.entries[1].minutesFromCompany, null);
    assert.deepEqual(findShuttleCandidates({ entries: data.entries, mode: "from-company", point: { lat: 37, lng: 127 }, departureAt: "2026-09-16T17:00:00", accessMinutesByStop: new Map([["stop", 5]]) }), []);
  }
});

test("published data uses the verified month and never treats missing duration as a trip", async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-data.js", import.meta.url), "utf8"), { window });
  const data = window.HAPPYROAD_MAP_DATA;
  assert.equal(data.source.monthly.from, "2026-08-16");
  assert.equal(data.source.monthly.through, "2026-09-15");
  const first = data.entries.find(row => row.turnUid === "202506130427240551194650973LNT" && row.stopOrder === 1);
  assert.equal(first.time, "05:33:00");
  assert.equal(first.timeBasis, "scheduled");
  for (const row of data.entries.filter(row => row.timeBasis)) {
    assert.ok(row.sampleDays >= 0 && row.sampleDays <= 31);
    if (row.timeBasis === "monthly-average") assert.ok(row.sampleDays > 0);
    if (row.timeBasis === "missing") assert.equal(row.time, "");
    if (row.displayMinutes !== null) assert.ok(row.displayMinutes >= 0 && row.displayMinutes <= 300);
    if (row.direction === "퇴근" && row.isCompany && row.timeBasis === "scheduled") assert.equal(row.time, row.scheduledCompanyDepartureTime);
  }
});

test("page and offline shell version both shuttle assets to avoid stale HTTP caches", async () => {
  const [html, worker] = await Promise.all(["../public/index.html", "../public/sw.js"].map(file => readFile(new URL(file, import.meta.url), "utf8")));
  for (const file of ["shuttle-data", "shuttle-time-estimates"]) {
    const url = `./data/${file}.js?v=${file === "shuttle-data" ? "20260921" : "20260916"}`;
    assert.ok(html.includes(`src="${url}"`));
    assert.ok(worker.includes(`"${url}"`));
  }
});


test("service calendar import preserves official weekday codes and rejects unknown codes", () => {
  const shuttle = { entries:[{turnUid:"fri"},{turnUid:"sat"},{turnUid:"off"},{turnUid:"missing"}] };
  const details = new Map([
    ["fri",{earlyDriveWeekly:[{weekdayCode:"WKD-FRI",earlyMinute:0}]}],
    ["sat",{earlyDriveWeekly:[{weekdayCode:"WKD-SAT",earlyMinute:0}]}],
    ["off",{useYn:false,earlyDriveWeekly:[{weekdayCode:"WKD-MON",earlyMinute:0}]}]
  ]);
  applyServiceWeekdays(shuttle,details);
  assert.deepEqual(shuttle.entries.map(e=>e.serviceWeekdays),[[5],[6],[],[]]);
  assert.throws(()=>applyServiceWeekdays({entries:[{turnUid:"bad"}]},new Map([["bad",{earlyDriveWeekly:[{weekdayCode:"UNKNOWN"}]}]])),/Unknown service weekday/);
});

test("published commute runs carry validated weekday arrays and preserve restricted schedules", async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-data.js", import.meta.url),"utf8"),{window});
  const entries = window.HAPPYROAD_MAP_DATA.entries.filter(e=>["출근","퇴근"].includes(e.direction));
  for (const e of entries) {
    assert.ok(Array.isArray(e.serviceWeekdays),e.uidKey);
    assert.ok(e.serviceWeekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6));
  }
  for (const [name,days] of [["천호/구의(토)",[6]],["천호/답십리(자율)(금)",[5]],["광주선(월~목)",[1,2,3,4]]]) {
    assert.deepEqual(Array.from(entries.find(e=>e.routeName===name).serviceWeekdays),days);
  }
});
