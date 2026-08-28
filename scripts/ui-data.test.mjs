import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apartmentDetailHtml, stopDetailHtml } from "../public/detail-view.js";
import { formatDate, safeExternalUrl } from "../public/ui-utils.js";

test("untrusted dates and external URLs cannot become executable HTML", () => {
  assert.equal(formatDate('<img src=x onerror="alert(1)">'), "날짜 없음");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "https://new.land.naver.com/");
  assert.equal(safeExternalUrl("https://new.land.naver.com/complexes/123"), "https://new.land.naver.com/complexes/123");
});
test("apartment numeric metadata cannot inject executable HTML", () => {
  const payload = '<img src=x onerror="alert(1)">';
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: payload, completed: "2026", externalUrl: "" },
    relatedLinks: [{ station: "정류장", routes: ["노선"], distanceKm: 0.2, travelMinutes: payload }],
    commute: { inbound: { totalMinutes: payload, shuttleMinutes: payload, walkingMinutes: payload }, roundTripMinutes: payload },
    record: null,
    selectedArea: "전체"
  });
  assert.doesNotMatch(html, /<img/);
  assert.equal(html.match(/&lt;img/g)?.length, 1);
});

test("apartment area keys cannot inject executable HTML", () => {
  const payload = '<img src=x onerror="alert(1)">';
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 100, completed: "2026", externalUrl: "" },
    relatedLinks: [],
    record: {
      matchStatus: "matched", latestTradeDate: "20260826", matchedTradeCount: 1,
      areas: { [payload]: { count: 1, min: 10000, average: 10000, max: 10000 } }
    },
    selectedArea: "전체"
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("apartment details show overall per-pyeong prices when target areas have no trades", () => {
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 325, completed: "2004", externalUrl: "" },
    relatedLinks: [],
    record: {
      matchStatus: "matched", latestTradeDate: "20260718", averagePerPyeong: 3283, matchedTradeCount: 24,
      areas: Object.fromEntries(["59", "84", "102", "115"].map(area => [area, { count: 0 }]))
    },
    selectedArea: "전체",
    priceMetric: "average"
  });
  assert.match(html, /전체 면적/);
  assert.match(html, /평당 3,283만/);
  assert.match(html, /24건 · 대상 면적 외 거래 포함/);
});

test("legacy details mark unavailable arithmetic averages as pending", () => {
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 325, completed: "2004", externalUrl: "" },
    relatedLinks: [],
    record: {
      matchStatus: "matched", latestTradeDate: "20260718", matchedTradeCount: 3,
      areas: { "84": { count: 3, min: 80000, median: 95000, max: 120000, medianPerPyeong: 3750 } }
    },
    selectedArea: "84",
    priceMetric: "average"
  });
  assert.match(html, /평균값 갱신 대기/);
  assert.doesNotMatch(html, /9억 5,000만원/);
});

test("legacy details distinguish nonstandard trades awaiting summaries", () => {
  const html = apartmentDetailHtml({
    complex: { name: "단지", type: "아파트", households: 325, completed: "2004", externalUrl: "" },
    relatedLinks: [],
    record: {
      matchStatus: "matched", latestTradeDate: "20260718", matchedTradeCount: 19, medianPerPyeong: 6132,
      areas: Object.fromEntries(["59", "84", "102", "115"].map(area => [area, { count: 0 }]))
    },
    selectedArea: "전체",
    priceMetric: "average"
  });
  assert.match(html, /평균값 갱신 대기/);
  assert.match(html, /최근 거래 19건/);
  assert.doesNotMatch(html, /최근 실거래가가 없습니다/);
});

test("apartment details use the selected transaction price metric", () => {
  const common = {
    complex: { name: "단지", type: "아파트", households: 325, completed: "2004", externalUrl: "" },
    relatedLinks: [],
    record: {
      matchStatus: "matched", latestTradeDate: "20260718", matchedTradeCount: 3,
      areas: { "84": { count: 3, min: 80000, average: 100000, median: 95000, max: 120000, minPerPyeong: 3150, averagePerPyeong: 3950, maxPerPyeong: 4700 } }
    },
    selectedArea: "84"
  };
  assert.match(apartmentDetailHtml({ ...common, priceMetric: "max" }), /최고값[^<]*<\/h3>[\s\S]*12억/);
  assert.match(apartmentDetailHtml({ ...common, priceMetric: "average" }), /평균값[^<]*<\/h3>[\s\S]*10억/);
  assert.match(apartmentDetailHtml({ ...common, priceMetric: "min" }), /최저값[^<]*<\/h3>[\s\S]*8억/);
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
    copyFile(fileURLToPath(new URL("../scripts/price-refresh-lib.mjs", import.meta.url)), path.join(tempDir, "scripts", "price-refresh-lib.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/region-match.mjs", import.meta.url)), path.join(tempDir, "scripts", "region-match.mjs")),
    copyFile(fileURLToPath(new URL("../config/sgg.json", import.meta.url)), path.join(tempDir, "config", "sgg.json")),
    copyFile(fileURLToPath(new URL("../config/price-name-aliases.json", import.meta.url)), path.join(tempDir, "config", "price-name-aliases.json")),
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
    copyFile(fileURLToPath(new URL("../scripts/price-refresh-lib.mjs", import.meta.url)), path.join(tempDir, "scripts", "price-refresh-lib.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/region-match.mjs", import.meta.url)), path.join(tempDir, "scripts", "region-match.mjs")),
    copyFile(fileURLToPath(new URL("../config/sgg.json", import.meta.url)), path.join(tempDir, "config", "sgg.json")),
    copyFile(fileURLToPath(new URL("../config/price-name-aliases.json", import.meta.url)), path.join(tempDir, "config", "price-name-aliases.json")),
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

    const pricePath = path.join(tempDir, "public", "data", "prices.json");
    const unsafePrices = JSON.parse(await readFile(pricePath, "utf8"));
    unsafePrices.complexes.unsafe = {
      matchStatus: "matched",
      matchMethod: "unique_containment_name_and_lawd_cd_from_boundary",
      matchedOfficialNames: ["서로다른단지A", "서로다른단지B"]
    };
    await writeFile(pricePath, JSON.stringify(unsafePrices));
    const unsafeResult = await new Promise(resolve => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preloadPath).href, path.join(tempDir, "scripts", "refresh-prices.mjs")], {
        env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11200", MOLIT_MONTHS: "1" }
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("close", code => resolve({ code, stderr }));
    });
    assert.notEqual(unsafeResult.code, 0);
    assert.match(unsafeResult.stderr, /Inferred apartment matches must have exactly one official name/);
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
