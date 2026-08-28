import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { apartmentCommuteTimes } from "../public/filter-data.js";
import { routeSegmentPoints, routeSegmentSourcePoints } from "../public/route-view.js";

const execFileAsync = promisify(execFile);

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

test("estimate generator uses sibling schedules before protected Kakao driving", async t => {
  const directory = await mkdtemp(join(tmpdir(), "happyroad-estimates-"));
  const input = join(directory, "shuttle-data.js");
  const output = join(directory, "shuttle-time-estimates.js");
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ token: request.headers["x-happyroad-estimate-token"], body: JSON.parse(body) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ minutes: 15 }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const entries = [
    { turnUid: "reference", routeUid: "sibling-route", routeName: "기준", stationUid: "shared", station: "공통", direction: "출근", stopOrder: 1, companyTime: "08:00", time: "07:10", minutesToCompany: 50, lat: 37.5, lng: 127 },
    { turnUid: "sibling", routeUid: "sibling-route", routeName: "형제", stationUid: "shared", station: "공통", direction: "출근", stopOrder: 1, companyTime: "08:00", time: null, minutesToCompany: null, lat: 37.5, lng: 127 },
    { turnUid: "driving", routeUid: "driving-route", routeName: "주행", stationUid: "company", station: "회사", direction: "퇴근", stopOrder: 1, companyTime: "18:00", time: "18:00", minutesFromCompany: 0, isCompany: true, lat: 37.25, lng: 127.48 },
    { turnUid: "driving", routeUid: "driving-route", routeName: "주행", stationUid: "destination", station: "다음", direction: "퇴근", stopOrder: 2, companyTime: "18:00", time: null, minutesFromCompany: null, lat: 37.3, lng: 127.5 }
  ];
  await writeFile(input, `window.HAPPYROAD_MAP_DATA=${JSON.stringify({ entries })};`, "utf8");
  const address = server.address();
  await execFileAsync(process.execPath, [fileURLToPath(new URL("./refresh-shuttle-time-estimates.mjs", import.meta.url))], {
    env: {
      ...process.env,
      ROUTING_API_BASE: `http://127.0.0.1:${address.port}`,
      ROUTING_ORIGIN: "https://aaarmsdn.github.io",
      SHUTTLE_ESTIMATE_TOKEN: "test-estimate-token",
      SHUTTLE_DATA_URL: pathToFileURL(input).href,
      SHUTTLE_ESTIMATE_OUTPUT_URL: pathToFileURL(output).href
    }
  });

  const window = {};
  const context = { window };
  vm.runInNewContext(await readFile(input, "utf8"), context);
  vm.runInNewContext(await readFile(output, "utf8"), context);
  assert.deepEqual({ ...window.HAPPYROAD_SHUTTLE_TIME_ESTIMATES.methods }, { siblingSchedule: 1, kakaoDriving: 1 });
  assert.equal(window.HAPPYROAD_MAP_DATA.entries[1].minutesToCompany, 50);
  assert.equal(window.HAPPYROAD_MAP_DATA.entries[3].minutesFromCompany, 15);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].token, "test-estimate-token");
  assert.equal(requests[0].body.departureTime.length, 12);
});

test("Gwanggyo The Liv uses normal inbound and 18:00 outbound commute times", async () => {
  const window = {};
  const context = { window };
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-data.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(await readFile(new URL("../public/data/shuttle-time-estimates.js", import.meta.url), "utf8"), context);
  const apartments = JSON.parse(await readFile(new URL("../public/data/apartments.json", import.meta.url), "utf8"));
  const complex = apartments.complexes.find(item => item.name === "광교더리브");
  const links = apartments.links.filter(link => link.complexId === complex.id);
  const stations = new Map();
  for (const entry of window.HAPPYROAD_MAP_DATA.entries) {
    if (!stations.has(entry.stationUid)) stations.set(entry.stationUid, { entries: [] });
    stations.get(entry.stationUid).entries.push(entry);
  }

  const commute = apartmentCommuteTimes(links, stations, 1.5, true);
  assert.deepEqual([commute.inbound.totalMinutes, commute.outbound.totalMinutes, commute.roundTripMinutes], [63, 84, 147]);
  assert.ok(stations.get(commute.outbound.stationId).entries.some(entry => entry.turnName === "통상 18시퇴근" && entry.minutesFromCompany === 81));
});
