import { readFile, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDistricts, regionCodeFor } from "./region-match.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
dns.setDefaultResultOrder("ipv4first");

function usage() {
  console.log(`Usage: npm run prices:refresh

Required:
  MOLIT_API_KEY       data.go.kr service key

Optional:
  MOLIT_REGION_CODES  comma-separated five-digit LAWD_CD values
  MOLIT_MONTHS        months to fetch, default 3

Without MOLIT_REGION_CODES, apartment coordinates and config/sgg.json determine the required regions.`);
}

if (process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/아파트|주상복합|apt|\s|[-_.·]/g, "");
}

function comparableName(value) {
  return normalizeName(value)
    .replaceAll("에스케이", "sk")
    .replaceAll("엘지", "lg")
    .replace(/(\d+)(?:차|단지)/g, "$1");
}

function numberSignature(value) {
  return normalizeName(value).match(/\d+/g)?.join(":") || "";
}

function xmlValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return match?.[1]?.trim()
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"') ?? "";
}

function validTradeDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function parseTrades(xml) {
  // ponytail: API XML is flat today; replace with an XML parser if nested item fields are introduced.
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const item = match[1];
    const year = xmlValue(item, "dealYear");
    const month = xmlValue(item, "dealMonth").padStart(2, "0");
    const day = xmlValue(item, "dealDay").padStart(2, "0");
    return {
      name: xmlValue(item, "aptNm"),
      area: Number(xmlValue(item, "excluUseAr")),
      amount: Number(xmlValue(item, "dealAmount").replaceAll(",", "")),
      date: `${year}${month}${day}`
    };
  }).filter(trade => trade.name && trade.area > 0 && trade.amount > 0 && validTradeDate(trade.date));
}

function recentMonths(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function summarize(trades) {
  if (!trades.length) return { count: 0, min: null, median: null, max: null, medianPerPyeong: null };
  const amounts = trades.map(trade => trade.amount);
  const perPyeong = trades.map(trade => Math.round(trade.amount * 3.305785 / trade.area));
  return { count: trades.length, min: Math.min(...amounts), median: median(amounts), max: Math.max(...amounts), medianPerPyeong: median(perPyeong) };
}

function areaBand(area) {
  const bands = [59, 84, 102, 115];
  const nearest = bands.reduce((best, band) => Math.abs(area - band) < Math.abs(area - best) ? band : best);
  return Math.abs(area - nearest) <= 6 ? String(nearest) : null;
}

async function fetchWithRetry(url) {
  let lastError;
  const retryDelay = process.env.MOLIT_RETRY_DELAY_MS === undefined ? 5000 : Math.max(0, Number(process.env.MOLIT_RETRY_DELAY_MS));
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 6) await new Promise(resolve => setTimeout(resolve, retryDelay * Math.min(2 ** (attempt - 1), 6)));
  }
  throw lastError;
}

async function fetchMonth(serviceKey, regionCode, month) {
  const trades = [];
  let receivedItems = 0;
  let expectedTotal = null;
  const seenPageItems = new Set();
  let page = 1;
  while (true) {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("LAWD_CD", regionCode);
    url.searchParams.set("DEAL_YMD", month);
    url.searchParams.set("pageNo", String(page));
    url.searchParams.set("numOfRows", "1000");
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`MOLIT ${regionCode}/${month}: HTTP ${response.status}`);
    const xml = await response.text();
    const resultCode = xmlValue(xml, "resultCode");
    if (resultCode !== "000") throw new Error(`MOLIT ${regionCode}/${month}: ${resultCode || "missing resultCode"} ${xmlValue(xml, "resultMsg")}`);
    const totalValue = xmlValue(xml, "totalCount");
    if (!/^\d+$/.test(totalValue)) throw new Error(`MOLIT ${regionCode}/${month}: missing totalCount`);
    const rawItems = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(match => match[0]);
    const rawItemCount = rawItems.length;
    const pageItems = rawItems.join("");
    if (rawItemCount && seenPageItems.has(pageItems)) throw new Error(`MOLIT ${regionCode}/${month}: repeated pagination page`);
    if (rawItemCount) seenPageItems.add(pageItems);
    const parsedTrades = parseTrades(xml);
    if (parsedTrades.length !== rawItemCount) throw new Error(`MOLIT ${regionCode}/${month}: malformed trade item`);
    const pageTrades = parsedTrades.map(trade => ({ ...trade, regionCode }));
    trades.push(...pageTrades);
    receivedItems += rawItemCount;
    const total = Number(totalValue);
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal) throw new Error(`MOLIT ${regionCode}/${month}: totalCount changed during pagination`);
    if (receivedItems > total) throw new Error(`MOLIT ${regionCode}/${month}: item count exceeds totalCount`);
    if (receivedItems >= total) return trades;
    if (!rawItemCount) throw new Error(`MOLIT ${regionCode}/${month}: pagination ended before totalCount`);
    if (page >= 1000) throw new Error(`MOLIT ${regionCode}/${month}: pagination limit exceeded`);
    page += 1;
  }
}

const serviceKey = process.env.MOLIT_API_KEY ? decodeURIComponent(process.env.MOLIT_API_KEY) : "";
if (!serviceKey) throw new Error("MOLIT_API_KEY is required. Run with --help for setup.");

const monthsCount = Math.min(12, Math.max(1, Number(process.env.MOLIT_MONTHS || 3)));
const apartmentPath = path.join(projectDir, "public", "data", "apartments.json");
const pricePath = path.join(projectDir, "public", "data", "prices.json");
const boundaryPath = path.join(projectDir, "config", "sgg.json");
const aliasPath = path.join(projectDir, "config", "price-name-aliases.json");
const [apartments, prices, boundaries, nameAliases] = await Promise.all([
  readFile(apartmentPath, "utf8").then(JSON.parse),
  readFile(pricePath, "utf8").then(JSON.parse),
  readFile(boundaryPath, "utf8").then(JSON.parse),
  readFile(aliasPath, "utf8").then(JSON.parse)
]);

const districts = prepareDistricts(boundaries);
const complexById = new Map(apartments.complexes.map(complex => [complex.id, complex]));
const regionByComplex = new Map(apartments.complexes.map(complex => [complex.id, regionCodeFor(complex, districts)]));
const complexesByRegion = new Map();
for (const complex of apartments.complexes) {
  const regionCode = regionByComplex.get(complex.id);
  if (!complexesByRegion.has(regionCode)) complexesByRegion.set(regionCode, []);
  complexesByRegion.get(regionCode).push(complex);
}
const unmappedComplexes = [...regionByComplex.values()].filter(code => !code).length;
const derivedRegionCodes = [...new Set([...regionByComplex.values()].filter(Boolean))].sort();
const regionCodes = process.env.MOLIT_REGION_CODES
  ? process.env.MOLIT_REGION_CODES.split(",").map(value => value.trim()).filter(Boolean)
  : derivedRegionCodes;
if (!regionCodes.length || regionCodes.some(code => !/^\d{5}$/.test(code))) throw new Error("Region codes must be five-digit LAWD_CD values.");

const idsByName = new Map();
for (const complex of apartments.complexes) {
  const name = normalizeName(complex.name);
  if (!idsByName.has(name)) idsByName.set(name, []);
  idsByName.get(name).push(complex.id);
}
const idsByAlias = new Map();
for (const [complexId, aliases] of Object.entries(nameAliases)) {
  if (!complexById.has(complexId) || !Array.isArray(aliases)) throw new Error(`Invalid price alias config for complex ${complexId}.`);
  for (const alias of aliases) {
    if (typeof alias !== "string") throw new Error(`Invalid non-string price alias for complex ${complexId}.`);
    const name = normalizeName(alias);
    if (!name) throw new Error(`Invalid empty price alias for complex ${complexId}.`);
    if (!idsByAlias.has(name)) idsByAlias.set(name, []);
    idsByAlias.get(name).push(complexId);
  }
}

const trades = [];
for (const regionCode of regionCodes) {
  for (const month of recentMonths(monthsCount)) trades.push(...await fetchMonth(serviceKey, regionCode, month));
}
if (!trades.length) throw new Error("MOLIT returned no valid trades; existing prices were preserved.");

const grouped = new Map();
let skippedAmbiguous = 0;
let skippedNoName = 0;
let skippedRegionMismatch = 0;
let matchedByAlias = 0;
let matchedByUniqueContainment = 0;
const inferredIdsByTradeName = new Map();
for (const trade of trades) {
  const band = areaBand(trade.area);
  const ids = idsByName.get(normalizeName(trade.name)) || [];
  let regionIds = ids.filter(id => regionByComplex.get(id) === trade.regionCode);
  let matchMethod = "normalized_name_and_lawd_cd_from_boundary";
  if (!regionIds.length) {
    regionIds = (idsByAlias.get(normalizeName(trade.name)) || []).filter(id => regionByComplex.get(id) === trade.regionCode);
    if (regionIds.length) matchMethod = "configured_alias_and_lawd_cd_from_boundary";
  }
  if (!regionIds.length) {
    const cacheKey = `${trade.regionCode}:${normalizeName(trade.name)}`;
    if (!inferredIdsByTradeName.has(cacheKey)) {
      const tradeName = comparableName(trade.name);
      const tradeNumbers = numberSignature(trade.name);
      const candidates = (complexesByRegion.get(trade.regionCode) || []).filter(complex => {
        const complexName = comparableName(complex.name);
        return Math.min(tradeName.length, complexName.length) >= 4
          && numberSignature(complex.name) === tradeNumbers
          && (tradeName.includes(complexName) || complexName.includes(tradeName));
      });
      inferredIdsByTradeName.set(cacheKey, candidates.length === 1 ? [candidates[0].id] : []);
    }
    regionIds = inferredIdsByTradeName.get(cacheKey);
    if (regionIds.length) matchMethod = "unique_containment_name_and_lawd_cd_from_boundary";
  }
  if (!regionIds.length) {
    if (ids.length) skippedRegionMismatch += 1;
    else skippedNoName += 1;
    continue;
  }
  if (regionIds.length !== 1) {
    skippedAmbiguous += 1;
    continue;
  }
  if (matchMethod === "configured_alias_and_lawd_cd_from_boundary") matchedByAlias += 1;
  if (matchMethod === "unique_containment_name_and_lawd_cd_from_boundary") matchedByUniqueContainment += 1;
  if (!grouped.has(regionIds[0])) grouped.set(regionIds[0], []);
  grouped.get(regionIds[0]).push({ ...trade, band, matchMethod });
}
if (!grouped.size) throw new Error("MOLIT trades matched no configured apartment; existing prices were preserved.");

const refreshedRegions = new Set(regionCodes);
for (const [complexId, record] of Object.entries(prices.complexes)) {
  if (record.matchStatus !== "matched" || !refreshedRegions.has(record.matchRegionCode) || grouped.has(complexId)) continue;
  prices.complexes[complexId] = {
    matchStatus: "pending",
    matchMethod: null,
    matchRegionCode: null,
    matchedTradeCount: 0,
    latestTradeDate: null,
    source: "국토교통부 아파트 매매 실거래가 API",
    areas: Object.fromEntries(["59", "84", "102", "115"].map(band => [band, summarize([])]))
  };
}

for (const [complexId, complexTrades] of grouped) {
  const complex = complexById.get(complexId);
  const record = prices.complexes[complexId] || {};
  record.matchStatus = "matched";
  const matchMethods = new Set(complexTrades.map(trade => trade.matchMethod));
  record.matchMethod = matchMethods.has("configured_alias_and_lawd_cd_from_boundary")
    ? "configured_alias_and_lawd_cd_from_boundary"
    : matchMethods.has("unique_containment_name_and_lawd_cd_from_boundary")
      ? "unique_containment_name_and_lawd_cd_from_boundary"
      : "normalized_name_and_lawd_cd_from_boundary";
  record.matchRegionCode = complexTrades[0].regionCode;
  record.matchedTradeCount = complexTrades.length;
  record.latestTradeDate = complexTrades.map(trade => trade.date).sort().at(-1);
  record.source = "국토교통부 아파트 매매 실거래가 API";
  record.medianPerPyeong = median(complexTrades.map(trade => Math.round(trade.amount * 3.305785 / trade.area)));
  record.areas = Object.fromEntries(["59", "84", "102", "115"].map(band => [band, summarize(complexTrades.filter(trade => trade.band === band))]));
  prices.complexes[complexId] = record;
  const observedAreas = Object.entries(record.areas).filter(([, area]) => area.count > 0).map(([band]) => band);
  complex.areaTags = ["59", "84", "102", "115"].filter(band => complex.areaTags.includes(band) || observedAreas.includes(band));
}

const generatedAt = new Date().toISOString();
prices.generatedAt = generatedAt;
prices.refresh = {
  source: "국토교통부 아파트 매매 실거래가 API",
  regionCodes,
  months: monthsCount,
  fetchedTrades: trades.length,
  updatedComplexes: grouped.size,
  unmappedComplexes,
  skippedNoName,
  skippedRegionMismatch,
  skippedAmbiguous,
  matchedByAlias,
  matchedByUniqueContainment
};
apartments.areaTagsGeneratedAt = generatedAt;
apartments.source.areaTagSource = "국토교통부 아파트 매매 실거래가 API";
apartments.stats.priceStatus = "official_api_refreshed";
apartments.stats.areaCounts = Object.fromEntries(["59", "84", "102", "115"].map(band => [band, apartments.complexes.filter(complex => complex.areaTags.includes(band)).length]));
await Promise.all([
  writeFile(apartmentPath, JSON.stringify(apartments)),
  writeFile(pricePath, JSON.stringify(prices))
]);
console.log(JSON.stringify(prices.refresh, null, 2));
