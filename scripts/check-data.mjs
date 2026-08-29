import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { areaRange, isCanonicalAreaKey } from "../public/area-data.js";
import { priceRecordForDisplay } from "../public/filter-data.js";
import { prepareDistricts, regionCodeFor } from "./region-match.mjs";
import { addressIdentityKey } from "./price-refresh-lib.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(projectDir, "public", "data");
const [apartments, prices, schools, boundaries, snapshotProvenance, addressIdentities] = await Promise.all([
  readFile(path.join(dataDir, "apartments.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDir, "prices.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDir, "schools.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectDir, "config", "sgg.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectDir, "config", "price-snapshot.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectDir, "config", "price-address-identities.json"), "utf8").then(JSON.parse)
]);

if (!Array.isArray(apartments.complexes) || apartments.complexes.length < 1) throw new Error("No apartment complexes");
if (!Array.isArray(apartments.links) || apartments.links.length < 1) throw new Error("No apartment links");
if (!prices.complexes || Object.keys(prices.complexes).length < 1) throw new Error("No apartment prices");
if (!Array.isArray(schools.schools) || schools.schools.length < 10000) throw new Error("School location data is incomplete");
if (!schools.source?.name || !schools.source?.url || !/^\d{4}-\d{2}-\d{2}$/.test(schools.source?.dataDate || "")) throw new Error("School source metadata is incomplete");
if (new Set(schools.schools.map(school => school.id)).size !== schools.schools.length) throw new Error("School IDs must be unique");
if (schools.schools.some(school => !school.id || !school.name || !school.address || !/^\d{4}-\d{2}-\d{2}$/.test(school.dataDate || "")
  || !["elementary", "middle", "high"].includes(school.level)
  || !Number.isFinite(school.lat) || school.lat < 33 || school.lat > 39
  || !Number.isFinite(school.lng) || school.lng < 124 || school.lng > 132)) throw new Error("School data contains invalid level or coordinates");
if (apartments.complexes.some(complex => "listings" in complex)) throw new Error("Apartment listing snapshots must not be committed");
if (Object.values(prices.complexes).some(record => "naverMarker" in record || "trends" in record)) throw new Error("Third-party price snapshots must not be committed");
if (JSON.stringify(prices).toLowerCase().includes("naver")) throw new Error("Third-party price provenance must not be committed");
const complexById = new Map(apartments.complexes.map(complex => [complex.id, complex]));
const invalidAddressIdentities = Object.entries(addressIdentities.complexes || {}).filter(([complexId, identities]) => {
  const complex = complexById.get(complexId);
  return !complex || !Array.isArray(identities) || !identities.length || identities.some(identity => {
    const [legalDong, jibun, extra] = String(identity).split("|");
    return extra || !addressIdentityKey(complex.regionCode, legalDong, jibun);
  });
});
if (invalidAddressIdentities.length || !/^[a-f0-9]{64}$/.test(addressIdentities.source?.sha256 || "")) throw new Error("Apartment address identity data is invalid");
const addressIdentityValues = Object.entries(addressIdentities.complexes || {}).flatMap(([complexId, identities]) =>
  identities.map(identity => `${complexById.get(complexId)?.regionCode}|${identity}`)
);
if (new Set(addressIdentityValues).size !== addressIdentityValues.length) throw new Error("Apartment address identities must belong to one complex");
const staleAddressPrices = Object.entries(prices.complexes).filter(([complexId, record]) => {
  if (record.matchStatus !== "matched") return false;
  const identities = addressIdentities.complexes?.[complexId] || [];
  if (!identities.length) return false;
  if (record.matchMethod !== "official_address_and_lawd_cd") return true;
  if (!Array.isArray(record.matchedOfficialAddresses) || !record.matchedOfficialAddresses.length) return true;
  const configuredAddresses = new Set(identities.map(identity => identity.replace("|", " ")));
  return record.matchedOfficialAddresses.some(address => !configuredAddresses.has(address));
});
if (staleAddressPrices.length) throw new Error(`${staleAddressPrices.length} priced records use stale apartment parcel identities`);
const hiddenPrices = Object.entries(prices.complexes).filter(([complexId, record]) =>
  record.matchStatus === "matched" && Object.values(record.areas || {}).some(area => Number(area?.median) > 0)
    && priceRecordForDisplay(prices, complexId, complexById.get(complexId)?.regionCode) !== record
);
if (hiddenPrices.length) throw new Error(`${hiddenPrices.length} priced records do not satisfy display provenance rules`);
const snapshotRecords = Object.values(prices.complexes).filter(record => record.matchMethod === "official_snapshot_by_complex_id");
if (snapshotRecords.length && (prices.snapshot?.sha256 !== snapshotProvenance.sha256 || prices.snapshot?.generatedAt !== snapshotProvenance.generatedAt)) throw new Error("Official snapshot provenance does not match the pinned source metadata");
if (snapshotRecords.some(record => record.source !== snapshotProvenance.source)) throw new Error("Official snapshot records have inconsistent source metadata");
const missingAreaTags = Object.entries(prices.complexes).flatMap(([complexId, record]) => Object.entries(record.areas || {})
  .filter(([band, area]) => {
    const tags = complexById.get(complexId)?.areaTags || [];
    return !isCanonicalAreaKey(band) || (record.matchStatus === "matched" && !tags.includes(areaRange(band)));
  })
  .map(([area]) => `${complexId}:${area}`));
if (missingAreaTags.length) throw new Error(`${missingAreaTags.length} priced apartment areas are missing filter tags`);

const complexIds = new Set(apartments.complexes.map(item => item.id));
const brokenLinks = apartments.links.filter(link => !complexIds.has(link.complexId));
if (brokenLinks.length) throw new Error(`${brokenLinks.length} apartment links reference missing complexes`);
const districts = prepareDistricts(boundaries);
const regionCodes = apartments.complexes.map(complex => regionCodeFor(complex, districts));
const unmappedComplexes = regionCodes.filter(code => !code);
if (unmappedComplexes.length) throw new Error(`${unmappedComplexes.length} apartment complexes are outside configured district boundaries`);
const mismatchedRegions = apartments.complexes.filter((complex, index) =>
  complex.regionCode !== regionCodes[index] && !(addressIdentities.complexes?.[complex.id] || []).length
);
if (mismatchedRegions.length) throw new Error(`${mismatchedRegions.length} apartment region codes differ from configured district boundaries`);

console.log(JSON.stringify({
  complexes: apartments.complexes.length,
  links: apartments.links.length,
  prices: Object.keys(prices.complexes).length,
  schools: schools.schools.length,
  districtRegions: new Set(regionCodes).size,
  generatedAt: prices.generatedAt
}, null, 2));
