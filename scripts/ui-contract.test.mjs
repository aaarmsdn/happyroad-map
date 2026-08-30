import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { commuteJourneyDetailHtml, commuteResultsHtml } from "../public/commute-view.js";
import { apartmentDetailHtml, schoolDetailHtml, stopDetailHtml } from "../public/detail-view.js";
import { apartmentDoorTimes, apartmentStopTimings, priceFor, priceRecordForDisplay, stopRepresentativeMinutes } from "../public/filter-data.js";
import { formatDate, safeExternalUrl } from "../public/ui-utils.js";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("public app metadata does not identify a specific employer", async () => {
  const [html, manifest, readme, packageJson] = await Promise.all([
    read("public/index.html"), read("public/manifest.webmanifest"), read("README.md"), read("package.json")
  ]);
  assert.match(html, /<title>하이로드<\/title>/);
  assert.match(html, /content="이동 경로와 주변 아파트를 한 지도에서 비교합니다\."/);
  assert.equal(JSON.parse(manifest).name, "하이로드 - 셔틀과 아파트");
  assert.equal(JSON.parse(packageJson).name, "happyroad-map");
  assert.match(readme, /^# 하이로드 웹앱/m);
  assert.doesNotMatch(`${html}\n${manifest}\n${readme}\n${packageJson}`, /sk\s*(?:하이닉스|hynix)|hynix/i);
});

test("header omits branding while each filter owns its update date", async () => {
  const html = await read("public/index.html");
  const shuttleView = html.slice(html.indexOf('data-view="shuttle"'), html.indexOf('data-view="apartment"'));
  const apartmentView = html.slice(html.indexOf('data-view="apartment"'), html.indexOf('<div class="panel-footer">'));
  assert.doesNotMatch(html, /class="brand-block"|id="dataFreshness"/);
  assert.match(shuttleView, /id="shuttleFreshness"/);
  assert.doesNotMatch(shuttleView, /id="apartmentFreshness"/);
  assert.match(apartmentView, /id="apartmentFreshness"/);
  assert.doesNotMatch(apartmentView, /id="shuttleFreshness"/);
});

test("stop details show shuttle duration and arrival time in both directions", () => {
  const html = stopDetailHtml({
    name: "성수역",
    lat: 37.54,
    lng: 127.05,
    entries: [
      {
        uidKey: "in-1", routeName: "성수 출근", routeCategory: "출근", turnName: "통상 출근", routeType: "통상",
        time: "06:30:12", companyTime: "08:00:00", minutesToCompany: 90
      },
      {
        uidKey: "out-1", routeName: "성수 퇴근", routeCategory: "퇴근", turnName: "통상 18시퇴근", routeType: "통상",
        time: "19:20:10", companyTime: "18:00:00", minutesFromCompany: 80
      }
    ]
  });
  assert.match(html, /06:30/);
  assert.match(html, /90분 · 회사 08:00 도착/);
  assert.match(html, /18:00/);
  assert.match(html, /80분 · 정류장 19:20 도착/);
});

test("stop details do not invent zero-minute outbound timings from missing data", () => {
  const html = stopDetailHtml({
    name: "시간 미확인 정류장",
    lat: 37.5,
    lng: 127,
    entries: [{
      uidKey: "out-missing", routeName: "퇴근선", routeCategory: "퇴근", turnName: "통상 18시퇴근", routeType: "통상",
      time: "", companyTime: "18:00", minutesFromCompany: null, turnFinalArrivalTime: "20:00"
    }]
  });
  assert.match(html, /18:00/);
  assert.doesNotMatch(html, /0분/);
  assert.doesNotMatch(html, /정류장 20:00 도착/);
});

test("apartment station timings prefer normal inbound and 18:00 outbound runs", () => {
  const timing = apartmentStopTimings([
    { routeCategory: "출근", turnName: "교대 출근", companyTime: "07:55", minutesToCompany: 45 },
    { routeCategory: "출근", turnName: "통상 출근", companyTime: "08:20", minutesToCompany: 62 },
    { routeCategory: "퇴근", turnName: "통상 17시퇴근", companyTime: "17:00", minutesFromCompany: 50 },
    { routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 58 }
  ]);
  assert.deepEqual(timing, {
    inboundMinutes: 62, outboundMinutes: 58,
    inboundStopAt: "07:18", inboundCompanyAt: "08:20", outboundCompanyAt: "18:00", outboundStopAt: "18:58",
    fallbackLabel: ""
  });
});

test("apartment door times include walking before and after the normal shuttle", () => {
  assert.deepEqual(apartmentDoorTimes({
    inboundStopAt: "06:30", outboundStopAt: "19:20"
  }, 0.96), { leaveHomeAt: "06:18", arriveHomeAt: "19:32" });
  assert.deepEqual(apartmentDoorTimes({
    inboundStopAt: "00:05", outboundStopAt: "23:55"
  }, 0.8), { leaveHomeAt: "23:55", arriveHomeAt: "00:05" });
  assert.deepEqual(apartmentDoorTimes({
    inboundStopAt: "07:27", outboundStopAt: "18:31"
  }, 0.3), { leaveHomeAt: "07:23", arriveHomeAt: "18:35" });
});

test("station timing uses direction for regional shuttle categories", () => {
  assert.deepEqual(apartmentStopTimings([
    { routeCategory: "이천->청주", direction: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 72 }
  ]), {
    inboundMinutes: null, outboundMinutes: 72,
    inboundStopAt: null, inboundCompanyAt: null, outboundCompanyAt: "18:00", outboundStopAt: "19:12",
    fallbackLabel: ""
  });
});

test("apartment station timings label the closest schedule fallback", () => {
  const timing = apartmentStopTimings([
    { routeCategory: "출근", turnName: "교대 출근", companyTime: "07:55", minutesToCompany: 45 },
    { routeCategory: "퇴근", turnName: "통상 17시퇴근", companyTime: "17:00", minutesFromCompany: 50 }
  ]);
  assert.deepEqual(timing, {
    inboundMinutes: 45, outboundMinutes: 50,
    inboundStopAt: "07:10", inboundCompanyAt: "07:55", outboundCompanyAt: "17:00", outboundStopAt: "17:50",
    fallbackLabel: "교대 출근 · 통상 17시퇴근 기준"
  });
});

test("apartment station timings omit a missing commute direction", () => {
  const timing = apartmentStopTimings([
    { routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 68 }
  ]);
  assert.deepEqual(timing, {
    inboundMinutes: null, outboundMinutes: 68,
    inboundStopAt: null, inboundCompanyAt: null, outboundCompanyAt: "18:00", outboundStopAt: "19:08",
    fallbackLabel: ""
  });
  assert.equal(stopRepresentativeMinutes([{ routeCategory: "퇴근", turnName: "통상 18시퇴근", companyTime: "18:00", minutesFromCompany: 68 }]), 68);
});

test("apartment details show inbound, outbound and walking values per stop", () => {
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 100, completed: "2020", externalUrl: "" },
    relatedLinks: [{
      station: "성수역", routes: ["노선"], distanceKm: 0.4, inboundMinutes: 62, outboundMinutes: 58,
      inboundStopAt: "06:30", inboundCompanyAt: "08:00", outboundCompanyAt: "18:00", outboundStopAt: "19:20",
      leaveHomeAt: "06:18", arriveHomeAt: "19:32", fallbackLabel: ""
    }],
    record: null,
    selectedArea: "전체"
  });
  assert.match(html, /출근 62분 · 퇴근 58분 · 도보 0\.4km/);
  assert.match(html, /집 06:18 출발 · 셔틀 06:30 · 회사 08:00/);
  assert.match(html, /회사 18:00 · 정류장 19:20 · 집 19:32 도착/);
  assert.match(html, /출퇴근/);
});

test("apartment details show only the available stop direction", () => {
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 100, completed: "2020", externalUrl: "" },
    relatedLinks: [{ station: "성수역", routes: ["노선"], distanceKm: 0.4, inboundMinutes: null, outboundMinutes: 58, fallbackLabel: "" }],
    record: null,
    selectedArea: "전체"
  });
  assert.match(html, /direction-badge">퇴근<\/em>/);
  assert.doesNotMatch(html, /출퇴근|출근 -|퇴근 -|노선 없음/);
});

test("empty area selection explains that apartment markers are hidden", () => {
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 100, completed: "2000", externalUrl: "" },
    relatedLinks: [], record: null, selectedArea: ""
  });
  assert.match(html, /전용면적을 선택하지 않아 아파트가 숨겨졌습니다/);
  assert.match(html, /국토교통부 API 매칭 정보 없음/);
  assert.doesNotMatch(html, />㎡ 최근 실거래가가 없습니다/);
});

test("all-area apartment details expose the same target-area maximum as the marker", () => {
  const record = {
    matchStatus: "matched", matchMethod: "unique_containment_name_and_lawd_cd_from_boundary", matchRegionCode: "41135",
    matchedTradeCount: 14, latestTradeDate: "20260701",
    max: 640000, maxPerPyeong: 10383,
    areas: {
      "102": { count: 2, min: 236000, max: 250000, maxPerPyeong: 8596 },
      "115": { count: 1, min: 269500, max: 269500, maxPerPyeong: 8080 }
    }
  };
  const base = { complex: { name: "알파리움1단지", type: "아파트", households: 417, completed: "2015", externalUrl: "" }, relatedLinks: [], record };
  const allAreas = apartmentDetailHtml({ ...base, selectedArea: "전체", priceMetric: "max" });
  assert.equal(priceFor({ complexes: { "106922": record } }, { area: "전체", priceMetric: "max" }, "106922", "41135"), 269500);
  assert.match(allAreas, /대표 115㎡[\s\S]*26억 9,500만원[\s\S]*1건/);
  assert.doesNotMatch(allAreas, /전체 면적|64억원/);
  assert.match(allAreas, /102㎡[\s\S]*25억원/);
  assert.match(allAreas, /115㎡[\s\S]*26억 9,500만원/);
  assert.doesNotMatch(apartmentDetailHtml({ ...base, selectedArea: "102", priceMetric: "max" }), /전체 면적|64억원/);
});

test("commute result UI exposes breakdown and concrete journey detail", () => {
  const journey = {
    accessMode: "public-transit", accessLabel: "대중교통", routeName: "노선", station: "성수역",
    shuttleAt: "07:00", arrivalAt: "08:00", totalMinutes: 90, waitMinutes: 20, shuttleMinutes: 60,
    accessMinutes: 10, accessEstimated: false, accessTransfers: 1, accessFare: 1550, direction: "to-company",
    accessRoute: { steps: [{ type: "subway", guidance: "2호선 성수역 → 강남역", minutes: 10, stopCount: 5 }] }
  };
  const results = commuteResultsHtml([journey]);
  assert.match(results, /총 90분/);
  assert.match(results, /대기[\s\S]*20분[\s\S]*셔틀[\s\S]*60분[\s\S]*대중교통[\s\S]*10분/);
  assert.match(results, /대중교통 총요금 1,550원/);
  assert.match(results, /경로 상세보기/);
  const detail = commuteJourneyDetailHtml(journey);
  assert.match(detail, /총합[\s\S]*90분[\s\S]*대기[\s\S]*20분[\s\S]*셔틀[\s\S]*60분[\s\S]*대중교통[\s\S]*10분/);
  assert.match(detail, /2호선 성수역 → 강남역/);
  assert.match(detail, /성수역 승차 → 회사 하차/);
  const homeDetail = commuteJourneyDetailHtml({ ...journey, direction: "from-company", shuttleAt: "18:00", arrivalAt: "19:23" });
  assert.match(homeDetail, /셔틀 \+ 대중교통/);
  assert.doesNotMatch(homeDetail, /대중교통 \+ 셔틀/);
  assert.match(homeDetail, /회사 · 18:00 출발 · 성수역 하차/);
  assert.doesNotMatch(homeDetail, /성수역 · 18:00 출발/);
  assert.match(homeDetail, /회사 승차 → 성수역 하차/);
});

test("walk and taxi durations show route distance", () => {
  const base = {
    accessLabel: "도보", routeName: "노선", station: "정류장", shuttleAt: "07:00", arrivalAt: "08:00",
    totalMinutes: 90, waitMinutes: 20, shuttleMinutes: 60, accessMinutes: 10, accessDistanceMeters: 1850,
    accessEstimated: false, accessTransfers: 0, accessFare: 0, direction: "to-company", accessRoute: { steps: [] }
  };
  assert.match(commuteResultsHtml([{ ...base, accessMode: "walk" }]), /10분 \(1\.9km\)/);
  assert.match(commuteJourneyDetailHtml({ ...base, accessMode: "car", accessLabel: "택시" }), /10분 \(1\.9km\)/);
  assert.match(commuteResultsHtml([{ ...base, accessMode: "walk", accessDistanceMeters: 0 }]), /10분 \(0\.0km\)/);
});

test("apartment settings expose highest, average, and lowest price modes", async () => {
  const html = await read("public/index.html");
  assert.match(html, /data-price-metric="max"[^>]*>최고값/);
  assert.match(html, /data-price-metric="average"[^>]*>평균값/);
  assert.match(html, /data-price-metric="min"[^>]*>최저값/);
});

test("apartment settings expose six contiguous area ranges", async () => {
  const html = await read("public/index.html");
  for (const [value, label] of [["59-69", "59~69㎡"], ["70-79", "70~79㎡"], ["80-89", "80~89㎡"], ["90-99", "90~99㎡"], ["100-109", "100~109㎡"], ["110-120", "110~120㎡"]]) {
    assert.match(html, new RegExp(`data-area="${value}"[^>]*>${label}`));
  }
  assert.doesNotMatch(html, /data-area="(?:59|84|102|115)"/);
});

test("apartment settings expose price, commute, and plain color modes", async () => {
  const html = await read("public/index.html");
  assert.match(html, /data-apartment-color="price"[^>]*>평당가/);
  assert.match(html, /data-apartment-color="commute"[^>]*>왕복시간/);
  assert.match(html, /data-apartment-color="none"[^>]*>단색/);
});

test("apartment settings expose directional five-minute commute sliders and walking option", async () => {
  const html = await read("public/index.html");
  assert.match(html, /id="inboundTimeMax"[^>]*type="range"[^>]*step="5"/);
  assert.match(html, /id="outboundTimeMax"[^>]*type="range"[^>]*step="5"/);
  assert.match(html, /id="includeWalking"[^>]*type="checkbox"[^>]*checked/);
  assert.doesNotMatch(html, /id="travelTimeMax"/);
});

test("map settings expose an opt-in school layer", async () => {
  const html = await read("public/index.html");
  assert.match(html, /id="showSchools"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="showSchools"[^>]*checked/);
});

test("apartment details show three nearest schools for every level", () => {
  const school = (name, level, distanceKm) => ({ name, level, distanceKm });
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 100, completed: "2020", externalUrl: "" },
    relatedLinks: [], record: null, selectedArea: "전체",
    schoolSource: { name: "한국교육시설안전원 초중고 학교 위치", dataDate: "2026-03-20", metrics: { name: "학교알리미", checkedAt: "2026-08-28" } }, schools: {
      elementary: [school("초1", "elementary", 0.2), school("초2", "elementary", 0.4), school("초3", "elementary", 0.6)],
      middle: [school("중1", "middle", 0.3), school("중2", "middle", 0.5), school("중3", "middle", 0.7)],
      high: [school("고1", "high", 0.8), school("고2", "high", 0.9), school("고3", "high", 1.0)]
    }
  });
  assert.match(html, /가까운 학교/);
  assert.match(html, /초등학교[\s\S]*초1[\s\S]*초2[\s\S]*초3/);
  assert.match(html, /중학교[\s\S]*중1[\s\S]*중2[\s\S]*중3/);
  assert.doesNotMatch(html, /학교알리미|학업지표|진학률|성취도/);
  assert.match(html, /한국교육시설안전원 초중고 학교 위치 · 기준일 2026-03-20/);
});

test("school details omit disconnected academic metrics", () => {
  const html = schoolDetailHtml(
    { name: "중학교", level: "middle", ownership: "공립", lat: 37.5, lng: 127, address: "서울" },
    { name: "한국교육시설안전원 초중고 학교 위치", dataDate: "2026-03-20", metrics: { name: "학교알리미", checkedAt: "2026-08-28" } }
  );
  assert.doesNotMatch(html, /학교알리미|학업 지표|학업지표|진학률|성취도|미연결/);
  assert.match(html, /중학교 · 공립[\s\S]*주소[\s\S]*서울/);
  assert.match(html, /한국교육시설안전원 초중고 학교 위치 · 기준일 2026-03-20/);
});

test("apartment detail uses auditable representative commute totals instead of stale link time", () => {
  const html = apartmentDetailHtml({
    complex: { name: "꽃메마을한라신영프로방스", type: "아파트", households: 388, completed: "2004", externalUrl: "" },
    relatedLinks: [
      { station: "훼미리프라자", routes: ["보정선"], distanceKm: 0.1, inboundMinutes: 62 },
      { station: "죽전간이정류장(퇴근)", routes: ["분당경부(토)"], distanceKm: 1.1, outboundMinutes: 39 }
    ], record: null, selectedArea: "전체",
    commute: {
      inbound: { shuttleMinutes: 62, walkingMinutes: 2, totalMinutes: 64 },
      outbound: { shuttleMinutes: 39, walkingMinutes: 14, totalMinutes: 53 },
      roundTripMinutes: 117
    }
  });
  assert.match(html, /출근[\s\S]*64분[\s\S]*셔틀 62 \+ 도보 2/);
  assert.match(html, /퇴근[\s\S]*53분[\s\S]*셔틀 39 \+ 도보 14/);
  assert.match(html, /왕복[\s\S]*117분/);
  assert.doesNotMatch(html, /통근[\s\S]*44분/);
  assert.match(html, /훼미리프라자[\s\S]*죽전간이정류장\(퇴근\)/);
});

test("walking-time changes refresh an already open apartment detail", async () => {
  const events = await read("public/app-events.js");
  assert.match(events, /includeWalking[\s\S]*renderMap\(\);\s*renderSelectedApartmentDetail\(\);/);
});

test("price summary changes trigger the automatic refresh workflow", async () => {
  const workflow = await read(".github/workflows/refresh-prices.yml");
  assert.match(workflow, /- "scripts\/price-refresh-lib\.mjs"/);
});

test("price refresh uses the Linux runner and retries each request instead of the whole batch", async () => {
  const workflow = await read(".github/workflows/refresh-prices.yml");
  assert.doesNotMatch(workflow, /windows-latest|for attempt in/);
  assert.match(workflow, /jobs:[\s\S]*?refresh:[\s\S]*?runs-on: ubuntu-latest/);
});

test("pending prices cannot reach apartment details", () => {
  const record = { matchStatus: "pending", matchMethod: "legacy", matchRegionCode: null, areas: { "84": { count: 1, median: 100000 } } };
  assert.equal(priceRecordForDisplay({ complexes: { "1": record } }, "1", "11200"), null);
});

test("a matched price with another district cannot reach apartment details", () => {
  const record = { matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "99999", areas: { "84": { count: 1, median: 100000 } } };
  assert.equal(priceRecordForDisplay({ complexes: { "1": record } }, "1", "11200"), null);
});

test("an official parcel match reaches apartment details", () => {
  const record = { matchStatus: "matched", matchMethod: "official_address_and_lawd_cd", matchRegionCode: "11200", areas: { "84": { count: 1, max: 100000 } } };
  assert.equal(priceRecordForDisplay({ complexes: { "1": record } }, "1", "11200"), record);
});

test("legacy snapshot prices remain unavailable until the current API matches them", () => {
  const record = { matchStatus: "snapshot", matchMethod: "official_snapshot_by_complex_id", matchRegionCode: "11200", areas: { "84": { count: 1, median: 100000 } } };
  const prices = { snapshot: { sha256: "a".repeat(64) }, complexes: { "1": record } };
  assert.equal(priceRecordForDisplay(prices, "1", "11200"), null);
  assert.equal(priceRecordForDisplay(prices, "1", "99999"), null);
});

test("parenthetical apartment type wraps as one readable unit", () => {
  const html = apartmentDetailHtml({
    complex: { name: "이천빌리브어바인시티1단지(주상복합)", type: "아파트", households: 1, completed: "2026", externalUrl: "" },
    relatedLinks: [], record: null, selectedArea: "전체"
  });
  assert.match(html, /1단지<wbr>\(주상복합\)/);
});

test("service worker never stores a JSON navigation as the app shell", async () => {
  const serviceWorker = await read("public/sw.js");
  const handlers = {};
  const cachePuts = [];
  const cache = {
    addAll: async () => {},
    put: async key => cachePuts.push(key)
  };
  const context = {
    URL,
    caches: { open: async () => cache, match: async () => new Response("offline") },
    fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    self: {
      location: { origin: "https://app.example" },
      clients: { claim: () => {} },
      skipWaiting: () => {},
      addEventListener: (type, handler) => { handlers[type] = handler; }
    }
  };
  vm.runInNewContext(serviceWorker, context);
  let responsePromise;
  handlers.fetch({
    request: { method: "GET", mode: "navigate", url: "https://app.example/data/prices.json" },
    respondWith: promise => { responsePromise = promise; }
  });
  await responsePromise;
  assert.deepEqual(cachePuts, []);
});

test("service worker falls back to cached HTML after a navigation network failure", async () => {
  const serviceWorker = await read("public/sw.js");
  const handlers = {};
  const events = [];
  const context = {
    URL,
    caches: {
      open: async () => ({ addAll: async () => {} }),
      match: async () => { events.push("cache"); return new Response("offline shell"); },
      keys: async () => []
    },
    fetch: async () => { events.push("network"); throw new Error("offline"); },
    self: {
      location: { origin: "https://app.example" },
      clients: { claim: () => {} },
      skipWaiting: () => {},
      addEventListener: (type, handler) => { handlers[type] = handler; }
    }
  };
  vm.runInNewContext(serviceWorker, context);
  let responsePromise;
  handlers.fetch({
    request: { method: "GET", mode: "navigate", url: "https://app.example/" },
    respondWith: promise => { responsePromise = promise; }
  });
  assert.equal(await (await responsePromise).text(), "offline shell");
  assert.deepEqual(events, ["network", "cache"]);
});

test("service worker precaches every versioned module dependency", async () => {
  const [serviceWorker, html] = await Promise.all([read("public/sw.js"), read("public/index.html")]);
  const handlers = {};
  let shell = [];
  const context = {
    URL,
    caches: { open: async () => ({ addAll: async resources => { shell = resources; } }) },
    self: {
      location: { origin: "https://app.example" },
      clients: { claim: () => {} },
      skipWaiting: () => {},
      addEventListener: (type, handler) => { handlers[type] = handler; }
    }
  };
  vm.runInNewContext(serviceWorker, context);
  let installPromise;
  handlers.install({ waitUntil: promise => { installPromise = promise; } });
  await installPromise;

  for (const [, entry] of html.matchAll(/(?:src|href)="(\.\/[^\"]+\?v=[^\"]+)"/g)) {
    assert.ok(shell.includes(entry), `index.html loads uncached ${entry}`);
  }

  for (const resource of shell.filter(item => /\.js\?v=/.test(item))) {
    const source = await read(`public/${resource.slice(2).split("?")[0]}`);
    for (const [, dependency] of source.matchAll(/from\s+"(\.\/[^\"]+)"/g)) {
      assert.ok(shell.includes(dependency), `${resource} imports uncached ${dependency}`);
    }
  }
});
