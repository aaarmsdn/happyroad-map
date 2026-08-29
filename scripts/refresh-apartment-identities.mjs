import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./price-refresh-lib.mjs";

const sourceUrl = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003521525&fileDetailSn=1&insertDataPrcus=N";
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/refresh-apartment-identities.mjs [official-identity.csv]");
  process.exit(0);
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') value += line[index++];
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function apartmentIdentity(row) {
  const parts = row.address.trim().split(/\s+/);
  const jibun = parts.pop();
  const lastDong = parts.pop();
  const legalDong = /[읍면]$/.test(parts.at(-1) || "") ? `${parts.at(-1)} ${lastDong}` : lastDong;
  return legalDong && jibun ? `${legalDong}|${jibun}` : null;
}

function closeHouseholdCount(actual, expected) {
  return actual > 0 && expected > 0 && Math.abs(actual - expected) <= Math.max(10, Math.round(expected * 0.02));
}

const inputPath = process.argv[2];
const csv = inputPath
  ? await readFile(path.resolve(inputPath), "utf8")
  : await fetch(sourceUrl).then(response => {
    if (!response.ok) throw new Error(`Apartment identity download failed: HTTP ${response.status}`);
    return response.text();
  });
const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines.shift());
if (header.length !== 10 || header[0] !== "단지고유번호" || header[1] !== "필지고유번호") throw new Error("Unexpected apartment identity CSV schema.");

const rowsByRegion = new Map();
const rowsByPnu = new Map();
for (const line of lines) {
  const values = parseCsvLine(line);
  if (values.length !== 10 || values[6] !== "1" || !/^\d{19}$/.test(values[1])) continue;
  const row = {
    id: values[0],
    pnu: values[1],
    address: values[2],
    names: values.slice(3, 6),
    nameKeys: new Set(values.slice(3, 6).map(normalizeName).filter(Boolean)),
    households: Number(values[8]) || 0,
    buildYear: Number(values[9].slice(0, 4)) || 0
  };
  const regionCode = row.pnu.slice(0, 5);
  if (!rowsByRegion.has(regionCode)) rowsByRegion.set(regionCode, []);
  rowsByRegion.get(regionCode).push(row);
  if (!rowsByPnu.has(row.pnu)) rowsByPnu.set(row.pnu, []);
  rowsByPnu.get(row.pnu).push(row);
}

const [apartments, aliases] = await Promise.all([
  readFile(path.join(projectDir, "public", "data", "apartments.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectDir, "config", "price-name-aliases.json"), "utf8").then(JSON.parse)
]);
const complexes = {};
const methods = {};
let ambiguous = 0;
let noCandidate = 0;
for (const complex of apartments.complexes) {
  const rows = rowsByRegion.get(complex.regionCode) || [];
  const baseName = normalizeName(complex.name);
  const aliasNames = new Set((aliases[complex.id] || []).map(normalizeName).filter(Boolean));
  let chosen = [];
  let method = null;
  if (aliasNames.size) {
    const matchesAlias = (name, alias) => name === alias || (alias.length >= 4 && name.startsWith(alias));
    const aliasRows = rows.filter(row => [...row.nameKeys].some(name => [...aliasNames].some(alias => matchesAlias(name, alias))));
    const foundAliases = new Set([...aliasNames].filter(alias => aliasRows.some(row => [...row.nameKeys].some(name => matchesAlias(name, alias)))));
    if (foundAliases.size === aliasNames.size) {
      chosen = aliasRows;
      method = "reviewed_alias";
    }
  }
  if (!chosen.length) {
    let candidates = rows.filter(row => [...row.nameKeys].some(name =>
      name === baseName || (Math.min(name.length, baseName.length) >= 4 && (name.startsWith(baseName) || baseName.startsWith(name)))
    ));
    const buildYear = Number(String(complex.completed || "").slice(0, 4)) || 0;
    const sameYear = candidates.filter(row => !buildYear || !row.buildYear || Math.abs(row.buildYear - buildYear) <= 1);
    if (sameYear.length) candidates = sameYear;
    const exact = candidates.filter(row => row.nameKeys.has(baseName));
    const exactHouseholds = exact.filter(row => closeHouseholdCount(row.households, complex.households));
    const matchingHouseholds = candidates.filter(row => closeHouseholdCount(row.households, complex.households));
    if (exactHouseholds.length === 1) {
      chosen = exactHouseholds;
      method = "exact_name_households_year";
    } else if (matchingHouseholds.length === 1) {
      chosen = matchingHouseholds;
      method = "contained_name_households_year";
    } else if (candidates.length && exact.length && new Set(candidates.map(row => row.pnu)).size === 1) {
      chosen = candidates;
      method = "exact_name_shared_parcel_year";
    } else if (candidates.length > 1 && closeHouseholdCount(candidates.reduce((sum, row) => sum + row.households, 0), complex.households)) {
      chosen = candidates;
      method = "contained_name_aggregate_households_year";
    }
  }
  const chosenIds = new Set(chosen.map(row => row.id));
  const safeRows = chosen.filter(row => rowsByPnu.get(row.pnu).every(candidate => chosenIds.has(candidate.id)));
  const identities = [...new Set(safeRows.map(apartmentIdentity).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ko"));
  if (identities.length) {
    complexes[complex.id] = identities;
    methods[method] = (methods[method] || 0) + 1;
  } else if (chosen.length) {
    ambiguous += 1;
  } else {
    noCandidate += 1;
  }
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    name: "한국부동산원 공동주택 단지 식별정보 기본정보",
    url: sourceUrl,
    sha256: createHash("sha256").update(csv).digest("hex")
  },
  stats: { matchedComplexes: Object.keys(complexes).length, ambiguous, noCandidate, methods },
  complexes
};
await writeFile(path.join(projectDir, "config", "price-address-identities.json"), JSON.stringify(output));
console.log(JSON.stringify(output.stats, null, 2));
