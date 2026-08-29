import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { areaKey, areaRange } from "../public/area-data.js";
import { comparableName, parseTrades, summarize, unmatchedNameReason } from "./price-refresh-lib.mjs";

test("reviewed aliases cover known official-name variants", async () => {
  const aliases = JSON.parse(await readFile(new URL("../config/price-name-aliases.json", import.meta.url), "utf8"));
  assert.deepEqual(aliases["154"], ["선경1차(1동-7동)", "선경2차(8동-12동)"]);
  assert.deepEqual(aliases["419"], ["삼익대청"]);
  assert.deepEqual(aliases["483"], ["성원대치2단지"]);
  assert.deepEqual(aliases["818"], ["우성8"]);
  assert.deepEqual(aliases["110632"], ["위례역푸르지오4단지", "위례역푸르지오5단지", "위례역푸르지오6단지"]);
  assert.deepEqual(aliases["2690"], ["정든마을(5단지)(신화)"]);
  assert.deepEqual(aliases["111368"], ["정든마을(1단지)(동아)"]);
  assert.deepEqual(aliases["2663"], ["정든마을(2단지)(동아)"]);
  assert.deepEqual(aliases["111064"], ["정든마을(4단지)(우성)"]);
  assert.deepEqual(aliases["2719"], ["정든마을(6단지)(우성)"]);
  assert.deepEqual(aliases["2592"], ["정든마을(6단지)(한진)"]);
  assert.deepEqual(aliases["2742"], ["정든마을(7단지)(한진)"]);
  assert.deepEqual(aliases["2829"], ["정든마을(8단지)(한진)"]);
});

test("apartment areas keep every whole-square-meter group from 59 through 120", () => {
  assert.equal(areaKey(58.99), null);
  assert.equal(areaKey(59.8), "59");
  assert.equal(areaKey(76.9), "76");
  assert.equal(areaKey(84.99), "84");
  assert.equal(areaKey(120), "120");
  assert.equal(areaKey(120.01), null);
  assert.equal(areaRange(76), "70-79");
  assert.equal(areaRange(84), "80-89");
  assert.equal(areaRange(120), "110-120");
});

test("MOLIT parser preserves official address identity fields", () => {
  const [trade] = parseTrades(`<items><item><aptNm>성원대치2단지아파트</aptNm><umdNm>개포동</umdNm><jibun>12</jibun><roadNm>개포로</roadNm><roadNmBonbun>12</roadNmBonbun><roadNmBubun>3</roadNmBubun><buildYear>1992</buildYear><excluUseAr>49.86</excluUseAr><dealAmount>205,500</dealAmount><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>30</dealDay></item></items>`);
  assert.deepEqual(trade, {
    name: "성원대치2단지아파트", legalDong: "개포동", jibun: "12", roadName: "개포로", roadMain: "12", roadSub: "3", buildYear: 1992,
    area: 49.86, amount: 205500, date: "20260730"
  });
});

test("trade summaries include arithmetic averages and per-pyeong extrema", () => {
  assert.deepEqual(summarize([
    { amount: 10000, area: 84 },
    { amount: 12000, area: 84 },
    { amount: 16000, area: 84 }
  ]), {
    count: 3,
    min: 10000,
    average: 12667,
    median: 12000,
    max: 16000,
    minPerPyeong: 394,
    averagePerPyeong: 498,
    medianPerPyeong: 472,
    maxPerPyeong: 630
  });
});

test("comparable apartment names ignore punctuation variants", () => {
  assert.equal(comparableName("SK,신일"), comparableName("에스케이신일"));
  assert.equal(comparableName("다산주공(3단지)"), comparableName("다산주공3단지"));
  assert.equal(comparableName("효자촌(임광)"), comparableName("효자촌임광"));
  assert.equal(comparableName("이편한세상센트레빌"), comparableName("e편한세상센트레빌"));
  assert.equal(comparableName("한강자이(고층)"), comparableName("한강자이"));
});

test("cross-region reviewed aliases remain distinguishable from unknown names", () => {
  assert.equal(unmatchedNameReason([], ["419"]), "region_mismatch");
  assert.equal(unmatchedNameReason([], []), "name_not_found");
});

test("price refresh matches official neighborhood-prefixed apartment names", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "happyroad-name-match-"));
  await Promise.all([
    mkdir(path.join(tempDir, "scripts"), { recursive: true }),
    mkdir(path.join(tempDir, "config"), { recursive: true }),
    mkdir(path.join(tempDir, "public", "data"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(fileURLToPath(new URL("../scripts/refresh-prices.mjs", import.meta.url)), path.join(tempDir, "scripts", "refresh-prices.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/price-refresh-lib.mjs", import.meta.url)), path.join(tempDir, "scripts", "price-refresh-lib.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/region-match.mjs", import.meta.url)), path.join(tempDir, "scripts", "region-match.mjs")),
    copyFile(fileURLToPath(new URL("../public/area-data.js", import.meta.url)), path.join(tempDir, "public", "area-data.js")),
    copyFile(fileURLToPath(new URL("../config/sgg.json", import.meta.url)), path.join(tempDir, "config", "sgg.json"))
  ]);
  const apartmentPath = path.join(tempDir, "public", "data", "apartments.json");
  const pricePath = path.join(tempDir, "public", "data", "prices.json");
  await Promise.all([
    writeFile(apartmentPath, JSON.stringify({
      source: {}, stats: {}, complexes: [
        { id: "97", name: "우성7차", lat: 37.53637, lng: 127.074587, areaTags: ["115"] },
        { id: "98", name: "현대7차", lat: 37.53638, lng: 127.074588, areaTags: ["84"] },
        { id: "99", name: "자양현대7차", lat: 37.53639, lng: 127.074589, areaTags: ["84"] },
        { id: "100", name: "LG한강자이(주상복합)", lat: 37.5364, lng: 127.0746, areaTags: ["84"] },
        { id: "101", name: "한강자이2차", lat: 37.53641, lng: 127.07461, areaTags: ["84"] },
        { id: "102", name: "테스트파크", lat: 37.53642, lng: 127.07462, areaTags: ["84"] },
        { id: "103", name: "샘플파크", lat: 37.53643, lng: 127.07463, areaTags: ["84"] },
        { id: "104", name: "별칭파크", lat: 37.53644, lng: 127.07464, areaTags: ["84"] }
      ]
    })),
    writeFile(pricePath, JSON.stringify({ complexes: {
      "98": {
        matchStatus: "matched",
        matchMethod: "configured_alias_and_lawd_cd_from_boundary",
        matchRegionCode: "11215",
        matchedTradeCount: 1,
        latestTradeDate: "20250101",
        source: "국토교통부 아파트 매매 실거래가 API",
        medianPerPyeong: 9999,
        areas: { "84": { count: 1, median: 99999, medianPerPyeong: 9999 } }
      }
    } })),
    writeFile(path.join(tempDir, "config", "price-name-aliases.json"), JSON.stringify({
      "97": ["자양우성7"], "98": ["자양현대7"], "99": ["자양현대7"], "104": ["공식별칭파크"]
    }))
  ]);
  const preloadPath = path.join(tempDir, "molit-name-alias.mjs");
  await writeFile(preloadPath, `const months = [];
let requests = 0;
globalThis.fetch = async url => {
  requests += 1;
  if (requests === 1) throw new TypeError("temporary network failure");
  months.push(new URL(url).searchParams.get("DEAL_YMD"));
  return new Response(\`<response><header><resultCode>000</resultCode></header><body><totalCount>11</totalCount><items><item><aptNm>자양우성7</aptNm><umdNm>자양동</umdNm><jibun>100</jibun><buildYear>1995</buildYear><excluUseAr>110.47</excluUseAr><dealAmount>165,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item><item><aptNm>자양현대7</aptNm><excluUseAr>84</excluUseAr><dealAmount>100,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item><item><aptNm>한강자이</aptNm><excluUseAr>113</excluUseAr><dealAmount>180,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>2</dealDay></item><item><aptNm>한강자이(고층)</aptNm><excluUseAr>113</excluUseAr><dealAmount>181,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>3</dealDay></item><item><aptNm>테스트파크</aptNm><excluUseAr>84</excluUseAr><dealAmount>88,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>2</dealDay></item><item><aptNm>서울테스트파크</aptNm><excluUseAr>84</excluUseAr><dealAmount>90,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>3</dealDay></item><item><aptNm>광진테스트파크</aptNm><excluUseAr>84</excluUseAr><dealAmount>95,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>4</dealDay></item><item><aptNm>서울샘플파크</aptNm><excluUseAr>84</excluUseAr><dealAmount>70,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>5</dealDay></item><item><aptNm>광진샘플파크</aptNm><excluUseAr>84</excluUseAr><dealAmount>75,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>6</dealDay></item><item><aptNm>공식별칭파크</aptNm><excluUseAr>84</excluUseAr><dealAmount>80,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>7</dealDay></item><item><aptNm>서울별칭파크</aptNm><umdNm>자양동</umdNm><jibun>200</jibun><roadNm>한강로</roadNm><roadNmBonbun>20</roadNmBonbun><buildYear>2001</buildYear><excluUseAr>84</excluUseAr><dealAmount>82,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>8</dealDay></item></items></body></response>\`, { status: 200 });
};
process.on("exit", () => console.error(\`FETCH_MONTHS=\${months.join(",")}\nREQUESTS=\${requests}\`));`);

  try {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preloadPath).href, path.join(tempDir, "scripts", "refresh-prices.mjs")], {
        env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11215", MOLIT_MONTHS: "12", MOLIT_RETRY_DELAY_MS: "0" }
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("close", code => resolve({ code, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    const prices = JSON.parse(await readFile(pricePath, "utf8"));
    assert.equal(prices.complexes["97"].matchStatus, "matched");
    assert.equal(prices.complexes["97"].matchMethod, "configured_alias_and_lawd_cd_from_boundary");
    assert.equal(prices.complexes["97"].medianPerPyeong, 4938);
    assert.equal(prices.complexes["97"].areas["110"].median, 165000);
    assert.equal(prices.complexes["97"].areas["110"].medianPerPyeong, 4938);
    assert.equal(prices.complexes["98"].matchStatus, "pending");
    assert.equal(prices.complexes["98"].matchMethod, null);
    assert.equal(prices.complexes["98"].medianPerPyeong, undefined);
    assert.equal(prices.complexes["99"], undefined);
    assert.equal(prices.complexes["100"].matchStatus, "matched");
    assert.equal(prices.complexes["100"].matchMethod, "unique_containment_name_and_lawd_cd_from_boundary");
    assert.equal(prices.complexes["100"].matchedTradeCount, 24);
    assert.equal(prices.complexes["100"].latestTradeDate, "20260803");
    assert.equal(prices.complexes["100"].max, 181000);
    assert.equal(prices.complexes["100"].average, 180500);
    assert.equal(prices.complexes["100"].medianPerPyeong, 5280);
    assert.deepEqual(prices.complexes["100"].matchedOfficialNames, ["한강자이", "한강자이(고층)"]);
    assert.equal(prices.complexes["100"].areas["113"].median, 180500);
    assert.equal(prices.complexes["101"], undefined);
    assert.equal(prices.complexes["102"].matchedTradeCount, 12);
    assert.deepEqual(prices.complexes["102"].matchedOfficialNames, ["테스트파크"]);
    assert.equal(prices.complexes["103"], undefined);
    assert.equal(prices.complexes["104"].matchedTradeCount, 12);
    assert.deepEqual(prices.complexes["104"].matchedOfficialNames, ["공식별칭파크"]);
    assert.deepEqual(prices.complexes["97"].matchedOfficialAddresses, ["자양동 100"]);
    assert.deepEqual(prices.complexes["97"].matchedBuildYears, [1995]);
    assert.equal(prices.refresh.matchedByUniqueContainment, 24);
    assert.equal(prices.refresh.skippedAmbiguous, 72);
    assert.deepEqual(prices.refresh.unmatchedOfficialTrades.find(item => item.officialName === "서울별칭파크"), {
      regionCode: "11215", officialName: "서울별칭파크", legalDong: "자양동", jibun: "200",
      roadAddress: "한강로 20", buildYear: 2001, reason: "ambiguous_name", count: 12
    });
    const months = result.stderr.match(/FETCH_MONTHS=([^\r\n]+)/)?.[1].split(",") || [];
    assert.equal(months.length, 12);
    assert.equal(new Set(months).size, 12);
    const now = new Date();
    const expectedMonths = Array.from({ length: 12 }, (_, offset) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    assert.deepEqual(months, expectedMonths);
    assert.match(result.stderr, /REQUESTS=13/);

    const beforeFailures = await readFile(pricePath);
    const rejectsRefresh = async (filename, source, message) => {
      const preload = path.join(tempDir, filename);
      await writeFile(preload, source);
      const failure = await new Promise(resolve => {
        const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, path.join(tempDir, "scripts", "refresh-prices.mjs")], {
          env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11215", MOLIT_MONTHS: "1", MOLIT_RETRY_DELAY_MS: "0" }
        });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("close", code => resolve({ code, stderr }));
      });
      assert.notEqual(failure.code, 0);
      assert.match(failure.stderr, message);
      assert.deepEqual(await readFile(pricePath), beforeFailures);
      return failure;
    };
    const item = amount => `<item><aptNm>자양우성7</aptNm><excluUseAr>110.47</excluUseAr><dealAmount>${amount}</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item>`;

    await rejectsRefresh("molit-total-mismatch.mjs", `globalThis.fetch = async url => {
  const page = new URL(url).searchParams.get("pageNo");
  const item = page === "1" ? ${JSON.stringify(item("165,000"))} : "";
  const total = page === "1" ? 2 : 1;
  return new Response(\`<response><header><resultCode>000</resultCode></header><body><totalCount>\${total}</totalCount><items>\${item}</items></body></response>\`, { status: 200 });
};`, /totalCount changed during pagination/);
    await rejectsRefresh("molit-overrun.mjs", `globalThis.fetch = async () => new Response(${JSON.stringify(`<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items>${item("165,000")}${item("166,000")}</items></body></response>`)}, { status: 200 });`, /item count exceeds totalCount/);
    await rejectsRefresh("molit-repeat.mjs", `globalThis.fetch = async url => {
  const page = new URL(url).searchParams.get("pageNo");
  const items = { "1": ${JSON.stringify(item("165,000"))}, "2": ${JSON.stringify(item("166,000"))}, "3": ${JSON.stringify(item("165,000"))} };
  return new Response(\`<response><header><resultCode>000</resultCode></header><body><totalCount>3</totalCount><items>\${items[page]}</items></body></response>\`, { status: 200 });
};`, /repeated pagination page/);
    await rejectsRefresh("molit-incomplete.mjs", `globalThis.fetch = async url => {
  const item = new URL(url).searchParams.get("pageNo") === "1" ? ${JSON.stringify(item("165,000"))} : "";
  return new Response(\`<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items>\${item}</items></body></response>\`, { status: 200 });
};`, /pagination ended before totalCount/);
    await rejectsRefresh("molit-malformed.mjs", `globalThis.fetch = async () => new Response(${JSON.stringify("<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><aptNm>자양우성7</aptNm><excluUseAr>110.47</excluUseAr><dealAmount></dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item></items></body></response>")}, { status: 200 });`, /malformed trade item/);
    const timeout = await rejectsRefresh("molit-timeout.mjs", `let requests = 0;
globalThis.fetch = async () => { requests += 1; throw new TypeError("connect timeout"); };
process.on("exit", () => console.error(\`REQUESTS=\${requests}\`));`, /connect timeout/);
    assert.match(timeout.stderr, /REQUESTS=10/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
