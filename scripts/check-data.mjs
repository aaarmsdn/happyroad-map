import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDistricts, regionCodeFor } from "./region-match.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(projectDir, "public", "data");
const [apartments, prices, boundaries] = await Promise.all([
  readFile(path.join(dataDir, "apartments.json"), "utf8").then(JSON.parse),
  readFile(path.join(dataDir, "prices.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectDir, "config", "sgg.json"), "utf8").then(JSON.parse)
]);

if (!Array.isArray(apartments.complexes) || apartments.complexes.length < 1) throw new Error("No apartment complexes");
if (!Array.isArray(apartments.links) || apartments.links.length < 1) throw new Error("No apartment links");
if (!prices.complexes || Object.keys(prices.complexes).length < 1) throw new Error("No apartment prices");
if (apartments.complexes.some(complex => "listings" in complex)) throw new Error("Apartment listing snapshots must not be committed");
if (Object.values(prices.complexes).some(record => "naverMarker" in record || "trends" in record)) throw new Error("Third-party price snapshots must not be committed");
if (JSON.stringify(prices).toLowerCase().includes("naver")) throw new Error("Third-party price provenance must not be committed");
const complexById = new Map(apartments.complexes.map(complex => [complex.id, complex]));
const unverifiedPrices = Object.entries(prices.complexes).filter(([complexId, record]) =>
  Object.values(record.areas || {}).some(area => Number(area?.median) > 0)
    && (record.matchStatus !== "matched" || record.matchRegionCode !== complexById.get(complexId)?.regionCode || record.matchMethod !== "normalized_name_and_lawd_cd_from_boundary")
);
if (unverifiedPrices.length) throw new Error(`${unverifiedPrices.length} displayed prices lack verified district provenance`);

const complexIds = new Set(apartments.complexes.map(item => item.id));
const brokenLinks = apartments.links.filter(link => !complexIds.has(link.complexId));
if (brokenLinks.length) throw new Error(`${brokenLinks.length} apartment links reference missing complexes`);
const districts = prepareDistricts(boundaries);
const regionCodes = apartments.complexes.map(complex => regionCodeFor(complex, districts));
const unmappedComplexes = regionCodes.filter(code => !code);
if (unmappedComplexes.length) throw new Error(`${unmappedComplexes.length} apartment complexes are outside configured district boundaries`);
const mismatchedRegions = apartments.complexes.filter((complex, index) => complex.regionCode !== regionCodes[index]);
if (mismatchedRegions.length) throw new Error(`${mismatchedRegions.length} apartment region codes differ from configured district boundaries`);

console.log(JSON.stringify({
  complexes: apartments.complexes.length,
  links: apartments.links.length,
  prices: Object.keys(prices.complexes).length,
  districtRegions: new Set(regionCodes).size,
  generatedAt: prices.generatedAt
}, null, 2));
