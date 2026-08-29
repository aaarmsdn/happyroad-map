import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressIdentityKey, normalizeName, uniqueParcelIdentity } from "./price-refresh-lib.mjs";

const sourceUrl = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003521525&fileDetailSn=1&insertDataPrcus=N";
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/refresh-apartment-identities.mjs [official-identity.csv] [--address-worker URL]");
  process.exit(0);
}

const args = process.argv.slice(2);
const workerIndex = args.indexOf("--address-worker");
const addressWorkerUrl = workerIndex >= 0 ? args[workerIndex + 1] : null;
if (workerIndex >= 0) args.splice(workerIndex, 2);
if (args.length > 1 || (workerIndex >= 0 && !addressWorkerUrl)) throw new Error("Invalid apartment identity arguments.");

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

async function reverseParcelIdentity(worker, complex) {
  worker.pathname = "/address";
  worker.search = new URLSearchParams({ lat: complex.lat, lng: complex.lng });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(worker, { headers: { origin: "https://aaarmsdn.github.io" }, signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const payload = await response.json();
        return {
          identity: String(payload.parcelIdentity || ""),
          regionCode: /^\d{5}$/.test(payload.regionCode || "") ? payload.regionCode : complex.regionCode
        };
      }
      if (response.status !== 429 && response.status < 500) return { identity: "", regionCode: complex.regionCode };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return null;
}

const inputPath = args[0];
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
const complexById = new Map(apartments.complexes.map(complex => [complex.id, complex]));
const complexes = {};
const methodByComplex = new Map();
let ambiguous = 0;
let noCandidate = 0;
const unresolvedReasons = new Map();
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
  const identities = [...new Set(safeRows.map(apartmentIdentity).filter(identity => {
    const [legalDong, jibun] = String(identity || "").split("|");
    return addressIdentityKey(complex.regionCode, legalDong, jibun);
  }))].sort((left, right) => left.localeCompare(right, "ko"));
  if (identities.length) {
    complexes[complex.id] = identities;
    methodByComplex.set(complex.id, method);
  } else if (chosen.length) {
    ambiguous += 1;
    unresolvedReasons.set(complex.id, "ambiguous");
  } else {
    noCandidate += 1;
    unresolvedReasons.set(complex.id, "noCandidate");
  }
}

if (addressWorkerUrl) {
  const worker = new URL(addressWorkerUrl);
  let failedLookups = 0;
  for (const complex of apartments.complexes.filter(item => !complexes[item.id] && !(aliases[item.id] || []).length)) {
    const location = await reverseParcelIdentity(worker, complex);
    if (location === null) {
      failedLookups += 1;
    } else if (location.identity) {
      const matches = (rowsByRegion.get(location.regionCode) || []).filter(row => apartmentIdentity(row) === location.identity);
      const pnu = matches.length ? matches[0].pnu : null;
      if (pnu && uniqueParcelIdentity(matches, rowsByPnu.get(pnu))) {
        complex.regionCode = location.regionCode;
        complexes[complex.id] = [location.identity];
        methodByComplex.set(complex.id, "coordinate_parcel");
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (failedLookups) throw new Error(`${failedLookups} apartment parcel lookups failed; identity data was not replaced.`);
}

const ownersByIdentity = new Map();
for (const [complexId, identities] of Object.entries(complexes)) {
  const regionCode = complexById.get(complexId)?.regionCode;
  for (const identity of identities) {
    const key = `${regionCode}|${identity}`;
    if (!ownersByIdentity.has(key)) ownersByIdentity.set(key, []);
    ownersByIdentity.get(key).push(complexId);
  }
}
const duplicateIdentities = new Set([...ownersByIdentity].filter(([, owners]) => owners.length > 1).map(([identity]) => identity));
for (const [complexId, identities] of Object.entries(complexes)) {
  const regionCode = complexById.get(complexId)?.regionCode;
  const uniqueIdentities = identities.filter(identity => !duplicateIdentities.has(`${regionCode}|${identity}`));
  if (uniqueIdentities.length) complexes[complexId] = uniqueIdentities;
  else delete complexes[complexId];
}
const methods = {};
for (const complexId of Object.keys(complexes)) {
  const method = methodByComplex.get(complexId);
  methods[method] = (methods[method] || 0) + 1;
}
ambiguous = apartments.complexes.filter(complex => !complexes[complex.id] && unresolvedReasons.get(complex.id) === "ambiguous").length;
noCandidate = apartments.complexes.length - Object.keys(complexes).length - ambiguous;

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    name: "한국부동산원 공동주택 단지 식별정보 기본정보",
    url: sourceUrl,
    sha256: createHash("sha256").update(csv).digest("hex")
  },
  stats: { matchedComplexes: Object.keys(complexes).length, ambiguous, noCandidate, duplicateIdentities: duplicateIdentities.size, methods },
  complexes
};
await Promise.all([
  writeFile(path.join(projectDir, "config", "price-address-identities.json"), JSON.stringify(output)),
  writeFile(path.join(projectDir, "public", "data", "apartments.json"), JSON.stringify(apartments))
]);
console.log(JSON.stringify(output.stats, null, 2));
