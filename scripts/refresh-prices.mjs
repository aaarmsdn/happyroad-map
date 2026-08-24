import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDistricts, regionCodeFor } from "./region-match.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";

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

function summarize(values) {
  return values.length ? { count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values) } : { count: 0, min: null, median: null, max: null };
}

function areaBand(area) {
  const bands = [59, 84, 102, 115];
  const nearest = bands.reduce((best, band) => Math.abs(area - band) < Math.abs(area - best) ? band : best);
  return Math.abs(area - nearest) <= 6 ? String(nearest) : null;
}

async function fetchMonth(serviceKey, regionCode, month) {
  const trades = [];
  let page = 1;
  while (true) {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("LAWD_CD", regionCode);
    url.searchParams.set("DEAL_YMD", month);
    url.searchParams.set("pageNo", String(page));
    url.searchParams.set("numOfRows", "1000");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MOLIT ${regionCode}/${month}: HTTP ${response.status}`);
    const xml = await response.text();
    const resultCode = xmlValue(xml, "resultCode");
    if (resultCode && resultCode !== "000") throw new Error(`MOLIT ${regionCode}/${month}: ${resultCode} ${xmlValue(xml, "resultMsg")}`);
    const pageTrades = parseTrades(xml).map(trade => ({ ...trade, regionCode }));
    trades.push(...pageTrades);
    const total = Number(xmlValue(xml, "totalCount")) || pageTrades.length;
    if (trades.length >= total || pageTrades.length < 1000) return trades;
    page += 1;
  }
}

const serviceKey = process.env.MOLIT_API_KEY ? decodeURIComponent(process.env.MOLIT_API_KEY) : "";
if (!serviceKey) throw new Error("MOLIT_API_KEY is required. Run with --help for setup.");

const monthsCount = Math.min(12, Math.max(1, Number(process.env.MOLIT_MONTHS || 3)));
const apartmentPath = path.join(projectDir, "public", "data", "apartments.json");
const pricePath = path.join(projectDir, "public", "data", "prices.json");
const boundaryPath = path.join(projectDir, "config", "sgg.json");
const [apartments, prices, boundaries] = await Promise.all([
  readFile(apartmentPath, "utf8").then(JSON.parse),
  readFile(pricePath, "utf8").then(JSON.parse),
  readFile(boundaryPath, "utf8").then(JSON.parse)
]);

const districts = prepareDistricts(boundaries);
const regionByComplex = new Map(apartments.complexes.map(complex => [complex.id, regionCodeFor(complex, districts)]));
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

const trades = [];
for (const regionCode of regionCodes) {
  for (const month of recentMonths(monthsCount)) trades.push(...await fetchMonth(serviceKey, regionCode, month));
}
if (!trades.length) throw new Error("MOLIT returned no valid trades; existing prices were preserved.");

const grouped = new Map();
let skippedAmbiguous = 0;
let skippedNoName = 0;
let skippedRegionMismatch = 0;
for (const trade of trades) {
  const ids = idsByName.get(normalizeName(trade.name));
  if (!ids?.length) {
    skippedNoName += 1;
    continue;
  }
  const regionIds = ids.filter(id => regionByComplex.get(id) === trade.regionCode);
  if (!regionIds.length) {
    skippedRegionMismatch += 1;
    continue;
  }
  if (regionIds.length !== 1) {
    skippedAmbiguous += 1;
    continue;
  }
  const band = areaBand(trade.area);
  if (!band) continue;
  if (!grouped.has(regionIds[0])) grouped.set(regionIds[0], []);
  grouped.get(regionIds[0]).push({ ...trade, band });
}
if (!grouped.size) throw new Error("MOLIT trades matched no configured apartment; existing prices were preserved.");

for (const [complexId, complexTrades] of grouped) {
  const record = prices.complexes[complexId] || {};
  record.matchStatus = "matched";
  record.matchMethod = "normalized_name_and_lawd_cd_from_boundary";
  record.matchRegionCode = complexTrades[0].regionCode;
  record.matchedTradeCount = complexTrades.length;
  record.latestTradeDate = complexTrades.map(trade => trade.date).sort().at(-1);
  record.source = "국토교통부 아파트 매매 실거래가 API";
  record.areas = Object.fromEntries(["59", "84", "102", "115"].map(band => [band, summarize(complexTrades.filter(trade => trade.band === band).map(trade => trade.amount))]));
  prices.complexes[complexId] = record;
}

prices.generatedAt = new Date().toISOString();
prices.refresh = {
  source: "국토교통부 아파트 매매 실거래가 API",
  regionCodes,
  months: monthsCount,
  fetchedTrades: trades.length,
  updatedComplexes: grouped.size,
  unmappedComplexes,
  skippedNoName,
  skippedRegionMismatch,
  skippedAmbiguous
};
await writeFile(pricePath, JSON.stringify(prices));
console.log(JSON.stringify(prices.refresh, null, 2));
