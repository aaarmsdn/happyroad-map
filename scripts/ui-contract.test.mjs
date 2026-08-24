import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { apartmentDetailHtml, stopDetailHtml } from "../public/detail-view.js";
import { priceRecordForDisplay } from "../public/filter-data.js";
import { addApartmentMarkers, spreadMarkerPoints } from "../public/map-view.js";
import { formatDate, safeExternalUrl } from "../public/ui-utils.js";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("coincident apartment markers receive separate screen positions", () => {
  const points = spreadMarkerPoints([{ x: 10, y: 10 }, { x: 10, y: 10 }], 32, [{ x: 10, y: 10 }]);
  assert.ok(Math.hypot(points[0].x - 10, points[0].y - 10) >= 32);
  assert.ok(Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) >= 32);
});

test("apartment markers render sub-100-million-won prices in ten-thousand-won units", () => {
  const iconHtml = [];
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
    priceOf: () => 8500, colorOf: () => "#f04438", onSelect: () => {}
  });
  assert.match(iconHtml.join(""), />8,500만</);
});

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

test("dense coincident markers never fall back to overlapping positions", () => {
  const points = spreadMarkerPoints(Array.from({ length: 100 }, () => ({ x: 0, y: 0 })));
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      assert.ok(Math.hypot(points[left].x - points[right].x, points[left].y - points[right].y) >= 32);
    }
  }
});

test("pending prices cannot reach apartment details", () => {
  const record = { matchStatus: "pending", matchMethod: "legacy", matchRegionCode: null, areas: { "84": { count: 1, median: 100000 } } };
  assert.equal(priceRecordForDisplay({ complexes: { "1": record } }, "1", "11200"), null);
});

test("a matched price with another district cannot reach apartment details", () => {
  const record = { matchStatus: "matched", matchMethod: "normalized_name_and_lawd_cd_from_boundary", matchRegionCode: "99999", areas: { "84": { count: 1, median: 100000 } } };
  assert.equal(priceRecordForDisplay({ complexes: { "1": record } }, "1", "11200"), null);
});

test("a pinned official snapshot is displayable only in its current district", () => {
  const record = { matchStatus: "snapshot", matchMethod: "official_snapshot_by_complex_id", matchRegionCode: "11200", areas: { "84": { count: 1, median: 100000 } } };
  const prices = { snapshot: { sha256: "a".repeat(64) }, complexes: { "1": record } };
  assert.equal(priceRecordForDisplay(prices, "1", "11200"), record);
  assert.equal(priceRecordForDisplay(prices, "1", "99999"), null);
});

test("parenthetical apartment type wraps as one readable unit", () => {
  const html = apartmentDetailHtml({
    complex: { name: "이천빌리브어바인시티1단지(주상복합)", type: "아파트", households: 1, completed: "2026", externalUrl: "" },
    nearestLink: null, relatedLinks: [], record: null, selectedArea: "전체"
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

test("untrusted dates and external URLs cannot become executable HTML", () => {
  assert.equal(formatDate('<img src=x onerror="alert(1)">'), "날짜 없음");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "https://new.land.naver.com/");
  assert.equal(safeExternalUrl("https://new.land.naver.com/complexes/123"), "https://new.land.naver.com/complexes/123");
});

test("apartment numeric metadata cannot inject executable HTML", () => {
  const payload = '<img src=x onerror="alert(1)">';
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: payload, completed: "2026", externalUrl: "" },
    nearestLink: { station: "정류장", distanceKm: 0.2, travelMinutes: payload },
    relatedLinks: [{ station: "정류장", routes: ["노선"], distanceKm: 0.2, travelMinutes: payload }],
    record: null,
    selectedArea: "전체"
  });
  assert.doesNotMatch(html, /<img/);
  assert.equal(html.match(/&lt;img/g)?.length, 3);
});

test("price refresh preserves existing data on empty API results", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "happyroad-refresh-"));
  await Promise.all([
    mkdir(path.join(tempDir, "scripts"), { recursive: true }),
    mkdir(path.join(tempDir, "config"), { recursive: true }),
    mkdir(path.join(tempDir, "public", "data"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(fileURLToPath(new URL("../scripts/refresh-prices.mjs", import.meta.url)), path.join(tempDir, "scripts", "refresh-prices.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/region-match.mjs", import.meta.url)), path.join(tempDir, "scripts", "region-match.mjs")),
    copyFile(fileURLToPath(new URL("../config/sgg.json", import.meta.url)), path.join(tempDir, "config", "sgg.json")),
    copyFile(fileURLToPath(new URL("../public/data/apartments.json", import.meta.url)), path.join(tempDir, "public", "data", "apartments.json")),
    copyFile(fileURLToPath(new URL("../public/data/prices.json", import.meta.url)), path.join(tempDir, "public", "data", "prices.json"))
  ]);
  const pricePath = path.join(tempDir, "public", "data", "prices.json");
  const refreshPath = path.join(tempDir, "scripts", "refresh-prices.mjs");
  const before = await readFile(pricePath);
  const preloadPath = path.join(tempDir, "empty-molit.mjs");
  await writeFile(preloadPath, `globalThis.fetch = async () => new Response("<response><header><resultCode>000</resultCode></header><body><totalCount>0</totalCount><items></items></body></response>", { status: 200 });`);

  try {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preloadPath).href, refreshPath], {
        env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11110", MOLIT_MONTHS: "1" }
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("close", code => resolve({ code, stderr }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /MOLIT returned no valid trades; existing prices were preserved/);
    assert.deepEqual(await readFile(pricePath), before);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("price refresh adds newly observed official unit sizes to apartment filters", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "happyroad-refresh-area-"));
  await Promise.all([
    mkdir(path.join(tempDir, "scripts"), { recursive: true }),
    mkdir(path.join(tempDir, "config"), { recursive: true }),
    mkdir(path.join(tempDir, "public", "data"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(fileURLToPath(new URL("../scripts/refresh-prices.mjs", import.meta.url)), path.join(tempDir, "scripts", "refresh-prices.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/region-match.mjs", import.meta.url)), path.join(tempDir, "scripts", "region-match.mjs")),
    copyFile(fileURLToPath(new URL("../config/sgg.json", import.meta.url)), path.join(tempDir, "config", "sgg.json")),
    copyFile(fileURLToPath(new URL("../public/data/apartments.json", import.meta.url)), path.join(tempDir, "public", "data", "apartments.json")),
    copyFile(fileURLToPath(new URL("../public/data/prices.json", import.meta.url)), path.join(tempDir, "public", "data", "prices.json"))
  ]);
  const apartmentPath = path.join(tempDir, "public", "data", "apartments.json");
  const apartmentFixture = JSON.parse(await readFile(apartmentPath, "utf8"));
  apartmentFixture.complexes.find(complex => complex.id === "8104").areaTags = ["102"];
  await writeFile(apartmentPath, JSON.stringify(apartmentFixture));
  const preloadPath = path.join(tempDir, "one-molit-trade.mjs");
  await writeFile(preloadPath, `globalThis.fetch = async () => new Response(\`<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>성수롯데캐슬파크</aptNm><excluUseAr>59.8</excluUseAr><dealAmount>150,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item></items></body></response>\`, { status: 200 });`);

  try {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preloadPath).href, path.join(tempDir, "scripts", "refresh-prices.mjs")], {
        env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11200", MOLIT_MONTHS: "1" }
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("close", code => resolve({ code, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    const apartments = JSON.parse(await readFile(apartmentPath, "utf8"));
    assert.deepEqual(apartments.complexes.find(complex => complex.id === "8104").areaTags, ["59", "102"]);
    assert.match(apartments.areaTagsGeneratedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(apartments.stats.priceStatus, "official_api_refreshed");
    assert.equal(apartments.stats.areaCounts["59"] > 0, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stop departures sort by numeric time", () => {
  const html = stopDetailHtml({
    name: "테스트", lat: 0, lng: 0,
    entries: [
      { uidKey: "late", time: "10:00", routeName: "늦은 노선", routeCategory: "출근", turnName: "", routeType: "" },
      { uidKey: "early", time: "9:00", routeName: "이른 노선", routeCategory: "출근", turnName: "", routeType: "" }
    ]
  });
  assert.ok(html.indexOf("이른 노선") < html.indexOf("늦은 노선"));
});
