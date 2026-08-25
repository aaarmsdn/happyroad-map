import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

test("price refresh matches official neighborhood-prefixed apartment names", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "happyroad-name-match-"));
  await Promise.all([
    mkdir(path.join(tempDir, "scripts"), { recursive: true }),
    mkdir(path.join(tempDir, "config"), { recursive: true }),
    mkdir(path.join(tempDir, "public", "data"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(fileURLToPath(new URL("../scripts/refresh-prices.mjs", import.meta.url)), path.join(tempDir, "scripts", "refresh-prices.mjs")),
    copyFile(fileURLToPath(new URL("../scripts/region-match.mjs", import.meta.url)), path.join(tempDir, "scripts", "region-match.mjs")),
    copyFile(fileURLToPath(new URL("../config/sgg.json", import.meta.url)), path.join(tempDir, "config", "sgg.json"))
  ]);
  const apartmentPath = path.join(tempDir, "public", "data", "apartments.json");
  const pricePath = path.join(tempDir, "public", "data", "prices.json");
  await Promise.all([
    writeFile(apartmentPath, JSON.stringify({
      source: {}, stats: {}, complexes: [
        { id: "97", name: "우성7차", lat: 37.53637, lng: 127.074587, areaTags: ["115"] },
        { id: "98", name: "현대7차", lat: 37.53638, lng: 127.074588, areaTags: ["84"] },
        { id: "99", name: "자양현대7차", lat: 37.53639, lng: 127.074589, areaTags: ["84"] }
      ]
    })),
    writeFile(pricePath, JSON.stringify({ complexes: {} })),
    writeFile(path.join(tempDir, "config", "price-name-aliases.json"), JSON.stringify({
      "97": ["자양우성7"], "98": ["자양현대7"], "99": ["자양현대7"]
    }))
  ]);
  const preloadPath = path.join(tempDir, "molit-name-alias.mjs");
  await writeFile(preloadPath, `const months = [];
globalThis.fetch = async url => {
  months.push(new URL(url).searchParams.get("DEAL_YMD"));
  return new Response(\`<response><header><resultCode>000</resultCode></header><body><totalCount>2</totalCount><items><item><aptNm>자양우성7</aptNm><excluUseAr>110.47</excluUseAr><dealAmount>165,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item><item><aptNm>자양현대7</aptNm><excluUseAr>84</excluUseAr><dealAmount>100,000</dealAmount><dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>1</dealDay></item></items></body></response>\`, { status: 200 });
};
process.on("exit", () => console.error(\`FETCH_MONTHS=\${months.join(",")}\`));`);

  try {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preloadPath).href, path.join(tempDir, "scripts", "refresh-prices.mjs")], {
        env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11215", MOLIT_MONTHS: "12" }
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
    assert.equal(prices.complexes["97"].areas["115"].median, 165000);
    assert.equal(prices.complexes["97"].areas["115"].medianPerPyeong, 4938);
    assert.equal(prices.complexes["98"], undefined);
    assert.equal(prices.complexes["99"], undefined);
    assert.equal(prices.refresh.skippedAmbiguous, 12);
    const months = result.stderr.match(/FETCH_MONTHS=([^\r\n]+)/)?.[1].split(",") || [];
    assert.equal(months.length, 12);
    assert.equal(new Set(months).size, 12);
    const now = new Date();
    const expectedMonths = Array.from({ length: 12 }, (_, offset) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    assert.deepEqual(months, expectedMonths);

    const beforeFailures = await readFile(pricePath);
    const rejectsRefresh = async (filename, source, message) => {
      const preload = path.join(tempDir, filename);
      await writeFile(preload, source);
      const failure = await new Promise(resolve => {
        const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, path.join(tempDir, "scripts", "refresh-prices.mjs")], {
          env: { ...process.env, MOLIT_API_KEY: "test", MOLIT_REGION_CODES: "11215", MOLIT_MONTHS: "1" }
        });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("close", code => resolve({ code, stderr }));
      });
      assert.notEqual(failure.code, 0);
      assert.match(failure.stderr, message);
      assert.deepEqual(await readFile(pricePath), beforeFailures);
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
