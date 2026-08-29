import { readFile, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressIdentityKey, comparableName, fetchMonth, normalizeName, numberSignature, recentMonths, summarize, unmatchedNameReason } from "./price-refresh-lib.mjs";
import { officialRegionCodeFor, prepareDistricts } from "./region-match.mjs";
import { APARTMENT_AREA_RANGES, areaKey, areaTagsForValues } from "../public/area-data.js";

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

Without MOLIT_REGION_CODES, stored legal-region codes determine the required regions; config/sgg.json is the fallback.`);
}

if (process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

const serviceKey = process.env.MOLIT_API_KEY ? decodeURIComponent(process.env.MOLIT_API_KEY) : "";
if (!serviceKey) throw new Error("MOLIT_API_KEY is required. Run with --help for setup.");

const monthsCount = Math.min(12, Math.max(1, Number(process.env.MOLIT_MONTHS || 3)));
const apartmentPath = path.join(projectDir, "public", "data", "apartments.json");
const pricePath = path.join(projectDir, "public", "data", "prices.json");
const boundaryPath = path.join(projectDir, "config", "sgg.json");
const aliasPath = path.join(projectDir, "config", "price-name-aliases.json");
const addressIdentityPath = path.join(projectDir, "config", "price-address-identities.json");
const [apartments, prices, boundaries, nameAliases, addressIdentities] = await Promise.all([
  readFile(apartmentPath, "utf8").then(JSON.parse),
  readFile(pricePath, "utf8").then(JSON.parse),
  readFile(boundaryPath, "utf8").then(JSON.parse),
  readFile(aliasPath, "utf8").then(JSON.parse),
  readFile(addressIdentityPath, "utf8").then(JSON.parse)
]);

const districts = prepareDistricts(boundaries);
const complexById = new Map(apartments.complexes.map(complex => [complex.id, complex]));
const regionByComplex = new Map(apartments.complexes.map(complex => [complex.id, officialRegionCodeFor(complex, districts)]));
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
const idsByAddress = new Map();
const addressesByComplex = new Map();
for (const [complexId, identities] of Object.entries(addressIdentities.complexes || {})) {
  if (!complexById.has(complexId) || !Array.isArray(identities) || !identities.length) throw new Error(`Invalid price address identity config for complex ${complexId}.`);
  const keys = new Set();
  for (const identity of identities) {
    const [legalDong, jibun, extra] = String(identity).split("|");
    const key = !extra && addressIdentityKey(regionByComplex.get(complexId), legalDong, jibun);
    if (!key) throw new Error(`Invalid price address identity for complex ${complexId}: ${identity}`);
    keys.add(key);
    if (!idsByAddress.has(key)) idsByAddress.set(key, []);
    idsByAddress.get(key).push(complexId);
  }
  addressesByComplex.set(complexId, keys);
}
const idsForTradeAddress = trade => idsByAddress.get(addressIdentityKey(trade.regionCode, trade.legalDong, trade.jibun)) || [];
const eligibleIdsFor = (ids, trade) => {
  const tradeKey = addressIdentityKey(trade.regionCode, trade.legalDong, trade.jibun);
  if (!tradeKey) return ids;
  return ids.filter(id => !addressesByComplex.has(id) || addressesByComplex.get(id).has(tradeKey));
};

const trades = [];
for (const regionCode of regionCodes) {
  for (const month of recentMonths(monthsCount)) trades.push(...await fetchMonth(endpoint, serviceKey, regionCode, month));
}
if (!trades.length) throw new Error("MOLIT returned no valid trades; existing prices were preserved.");
const targetTrades = trades
  .map(trade => ({ ...trade, band: areaKey(trade.area) }))
  .filter(trade => trade.band);
if (!targetTrades.length) throw new Error("MOLIT returned no trades from 59 through 120 square meters; existing prices were preserved.");

const inferredIdsByTradeName = new Map();
const claimedTradeNamesByComplex = new Map();
// Multiple official names for one inferred complex require a reviewed explicit alias.
for (const trade of targetTrades) {
  const normalizedTradeName = normalizeName(trade.name);
  const cacheKey = `${trade.regionCode}:${normalizedTradeName}`;
  if (inferredIdsByTradeName.has(cacheKey)) continue;
  const exactIds = eligibleIdsFor((idsByName.get(normalizedTradeName) || []).filter(id => regionByComplex.get(id) === trade.regionCode), trade);
  const aliasIds = eligibleIdsFor((idsByAlias.get(normalizedTradeName) || []).filter(id => regionByComplex.get(id) === trade.regionCode), trade);
  const configuredIds = exactIds.length ? exactIds : aliasIds;
  if (configuredIds.length) {
    if (configuredIds.length === 1) {
      if (!claimedTradeNamesByComplex.has(configuredIds[0])) claimedTradeNamesByComplex.set(configuredIds[0], new Set());
      claimedTradeNamesByComplex.get(configuredIds[0]).add(normalizedTradeName);
    }
    continue;
  }
  const tradeName = comparableName(trade.name);
  const tradeNumbers = numberSignature(trade.name);
  let candidates = (complexesByRegion.get(trade.regionCode) || []).filter(complex => {
    const complexName = comparableName(complex.name);
    return Math.min(tradeName.length, complexName.length) >= 4
      && numberSignature(complex.name) === tradeNumbers
      && (tradeName.includes(complexName) || complexName.includes(tradeName));
  }).filter(complex => eligibleIdsFor([complex.id], trade).length);
  if (candidates.length > 1 && trade.buildYear) {
    const sameBuildYear = candidates.filter(complex => Number(String(complex.completed || "").slice(0, 4)) === trade.buildYear);
    if (sameBuildYear.length === 1) candidates = sameBuildYear;
  }
  const ids = candidates.length === 1 ? [candidates[0].id] : [];
  inferredIdsByTradeName.set(cacheKey, ids);
  if (ids.length) {
    if (!claimedTradeNamesByComplex.has(ids[0])) claimedTradeNamesByComplex.set(ids[0], new Set());
    claimedTradeNamesByComplex.get(ids[0]).add(normalizedTradeName);
  }
}
const collidingInferredKeys = new Set();
for (const [cacheKey, ids] of inferredIdsByTradeName) {
  if (ids.length && claimedTradeNamesByComplex.get(ids[0]).size > 1) {
    inferredIdsByTradeName.set(cacheKey, []);
    collidingInferredKeys.add(cacheKey);
  }
}

const grouped = new Map();
let skippedAmbiguous = 0;
let skippedNoName = 0;
let skippedRegionMismatch = 0;
let skippedAddressMismatch = 0;
let matchedByAlias = 0;
let matchedByUniqueContainment = 0;
let matchedByAddress = 0;
const unmatchedOfficialTrades = new Map();
const rememberUnmatched = (trade, reason) => {
  const key = [trade.regionCode, trade.name, trade.legalDong, trade.jibun, trade.roadName, trade.roadMain, trade.roadSub, trade.buildYear].join("|");
  const existing = unmatchedOfficialTrades.get(key);
  if (existing) existing.count += 1;
  else unmatchedOfficialTrades.set(key, {
    regionCode: trade.regionCode,
    officialName: trade.name,
    legalDong: trade.legalDong || null,
    jibun: trade.jibun || null,
    roadAddress: trade.roadName ? `${trade.roadName} ${trade.roadMain || ""}${trade.roadSub && trade.roadSub !== "0" ? `-${trade.roadSub}` : ""}`.trim() : null,
    buildYear: trade.buildYear,
    reason,
    count: 1
  });
};
for (const trade of targetTrades) {
  const band = trade.band;
  const ids = idsByName.get(normalizeName(trade.name)) || [];
  const aliasIds = idsByAlias.get(normalizeName(trade.name)) || [];
  const directAddressIds = idsForTradeAddress(trade);
  let regionIds = directAddressIds.length === 1
    ? directAddressIds
    : eligibleIdsFor(ids.filter(id => regionByComplex.get(id) === trade.regionCode), trade);
  let matchMethod = directAddressIds.length === 1 ? "official_address_and_lawd_cd" : "normalized_name_and_lawd_cd_from_boundary";
  if (!regionIds.length) {
    regionIds = eligibleIdsFor(aliasIds.filter(id => regionByComplex.get(id) === trade.regionCode), trade);
    if (regionIds.length) matchMethod = "configured_alias_and_lawd_cd_from_boundary";
  }
  if (!regionIds.length) {
    const cacheKey = `${trade.regionCode}:${normalizeName(trade.name)}`;
    regionIds = eligibleIdsFor(inferredIdsByTradeName.get(cacheKey) || [], trade);
    if (regionIds.length) matchMethod = "unique_containment_name_and_lawd_cd_from_boundary";
    else if (collidingInferredKeys.has(cacheKey)) {
      skippedAmbiguous += 1;
      rememberUnmatched(trade, "ambiguous_name");
      continue;
    }
  }
  if (!regionIds.length) {
    const tradeKey = addressIdentityKey(trade.regionCode, trade.legalDong, trade.jibun);
    const configuredNameIds = [...ids, ...aliasIds].filter(id => regionByComplex.get(id) === trade.regionCode && addressesByComplex.has(id));
    if (tradeKey && configuredNameIds.length) {
      skippedAddressMismatch += 1;
      rememberUnmatched(trade, "address_mismatch");
      continue;
    }
    if (ids.length) {
      skippedRegionMismatch += 1;
    } else {
      skippedNoName += 1;
    }
    rememberUnmatched(trade, unmatchedNameReason(ids, aliasIds));
    continue;
  }
  if (regionIds.length !== 1) {
    skippedAmbiguous += 1;
    rememberUnmatched(trade, "ambiguous_name");
    continue;
  }
  if (matchMethod === "configured_alias_and_lawd_cd_from_boundary") matchedByAlias += 1;
  if (matchMethod === "unique_containment_name_and_lawd_cd_from_boundary") matchedByUniqueContainment += 1;
  if (matchMethod === "official_address_and_lawd_cd") matchedByAddress += 1;
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
    areas: {}
  };
}

for (const [complexId, complexTrades] of grouped) {
  const complex = complexById.get(complexId);
  const record = prices.complexes[complexId] || {};
  record.matchStatus = "matched";
  const matchMethods = new Set(complexTrades.map(trade => trade.matchMethod));
  record.matchMethod = matchMethods.has("official_address_and_lawd_cd")
    ? "official_address_and_lawd_cd"
    : matchMethods.has("configured_alias_and_lawd_cd_from_boundary")
      ? "configured_alias_and_lawd_cd_from_boundary"
      : matchMethods.has("unique_containment_name_and_lawd_cd_from_boundary")
        ? "unique_containment_name_and_lawd_cd_from_boundary"
        : "normalized_name_and_lawd_cd_from_boundary";
  record.matchRegionCode = complexTrades[0].regionCode;
  record.matchedTradeCount = complexTrades.length;
  record.latestTradeDate = complexTrades.map(trade => trade.date).sort().at(-1);
  record.source = "국토교통부 아파트 매매 실거래가 API";
  record.matchedOfficialNames = [...new Set(complexTrades.map(trade => trade.name))].sort((a, b) => a.localeCompare(b, "ko"));
  record.matchedOfficialAddresses = [...new Set(complexTrades.map(trade => [trade.legalDong, trade.jibun].filter(Boolean).join(" ")).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  record.matchedBuildYears = [...new Set(complexTrades.map(trade => trade.buildYear).filter(Boolean))].sort((a, b) => a - b);
  const overall = summarize(complexTrades);
  record.min = overall.min;
  record.average = overall.average;
  record.median = overall.median;
  record.max = overall.max;
  record.minPerPyeong = overall.minPerPyeong;
  record.averagePerPyeong = overall.averagePerPyeong;
  record.medianPerPyeong = overall.medianPerPyeong;
  record.maxPerPyeong = overall.maxPerPyeong;
  const areaKeys = [...new Set(complexTrades.map(trade => trade.band))].sort((a, b) => Number(a) - Number(b));
  record.areas = Object.fromEntries(areaKeys.map(band => [band, summarize(complexTrades.filter(trade => trade.band === band))]));
  prices.complexes[complexId] = record;
  complex.areaTags = areaTagsForValues([...(complex.areaTags || []), ...areaKeys]);
}
for (const complex of apartments.complexes) complex.areaTags = areaTagsForValues(complex.areaTags || []);
if (Object.entries(prices.complexes).some(([complexId, record]) =>
  (refreshedRegions.has(record.matchRegionCode) || !complexById.has(complexId))
  && record.matchMethod === "unique_containment_name_and_lawd_cd_from_boundary"
  && new Set(record.matchedOfficialNames?.map(normalizeName)).size !== 1)) {
  throw new Error("Inferred apartment matches must have exactly one official name.");
}

const generatedAt = new Date().toISOString();
prices.generatedAt = generatedAt;
prices.refresh = {
  source: "국토교통부 아파트 매매 실거래가 API",
  regionCodes,
  months: monthsCount,
  fetchedTrades: trades.length,
  targetAreaTrades: targetTrades.length,
  updatedComplexes: grouped.size,
  unmappedComplexes,
  skippedNoName,
  skippedRegionMismatch,
  skippedAmbiguous,
  skippedAddressMismatch,
  matchedByAlias,
  matchedByUniqueContainment,
  matchedByAddress,
  unmatchedOfficialTrades: [...unmatchedOfficialTrades.values()].sort((a, b) => a.regionCode.localeCompare(b.regionCode) || a.officialName.localeCompare(b.officialName, "ko"))
};
apartments.areaTagsGeneratedAt = generatedAt;
apartments.source.areaTagSource = "국토교통부 아파트 매매 실거래가 API";
apartments.source.areaFilter = "59_to_120_exact_integer_groups";
apartments.stats.priceStatus = "official_api_refreshed";
apartments.stats.areaFilter = "59_to_120";
apartments.stats.areaCounts = Object.fromEntries(APARTMENT_AREA_RANGES.map(([range]) => [range, apartments.complexes.filter(complex => complex.areaTags.includes(range)).length]));
await Promise.all([
  writeFile(apartmentPath, JSON.stringify(apartments)),
  writeFile(pricePath, JSON.stringify(prices))
]);
console.log(JSON.stringify(prices.refresh, null, 2));
