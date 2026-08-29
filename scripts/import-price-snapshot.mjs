import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APARTMENT_AREA_RANGES, areaKeysForSelection, areaTagsForValues } from "../public/area-data.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run prices:import-snapshot -- <path-to-happyroad_actual_price_data.js>");
  process.exit(0);
}

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Snapshot source path is required. Run with --help for usage.");

const provenance = JSON.parse(await readFile(path.join(projectDir, "config", "price-snapshot.json"), "utf8"));
const sourceText = await readFile(path.resolve(sourcePath), "utf8");
const sourceHash = createHash("sha256").update(sourceText).digest("hex");
if (sourceHash !== provenance.sha256) throw new Error("Snapshot source hash does not match config/price-snapshot.json");

const prefix = "window.HAPPYROAD_ACTUAL_PRICE_DATA=";
if (!sourceText.startsWith(prefix)) throw new Error("Snapshot source has an unexpected format");
const snapshot = JSON.parse(sourceText.slice(prefix.length).replace(/;\s*$/, ""));
if (snapshot?.generatedAt !== provenance.generatedAt || !snapshot.priceByComplex) throw new Error("Snapshot source metadata is invalid");

const apartmentPath = path.join(projectDir, "public", "data", "apartments.json");
const pricePath = path.join(projectDir, "public", "data", "prices.json");
const [apartments, prices] = await Promise.all([
  readFile(apartmentPath, "utf8").then(JSON.parse),
  readFile(pricePath, "utf8").then(JSON.parse)
]);
let updatedComplexes = 0;

for (const complex of apartments.complexes) {
  const source = snapshot.priceByComplex[complex.id];
  if (source?.matchStatus !== "matched") continue;
  const observed = areaKeysForSelection(source.areas);
  if (!observed.length) continue;
  const areas = Object.fromEntries(observed.map(area => [area, source.areas[area]]));
  complex.areaTags = areaTagsForValues([...(complex.areaTags || []), ...observed]);
  prices.complexes[complex.id] = {
    matchStatus: "snapshot",
    matchMethod: "official_snapshot_by_complex_id",
    matchRegionCode: complex.regionCode,
    matchedTradeCount: source.matchedTradeCount,
    latestTradeDate: source.latestTradeDate,
    source: provenance.source,
    areas
  };
  updatedComplexes += 1;
}

apartments.areaTagsGeneratedAt = provenance.generatedAt;
apartments.source.areaTagSource = provenance.source;
apartments.source.areaFilter = "59_to_120_exact_integer_groups";
apartments.stats.priceStatus = "official_snapshot_seeded";
apartments.stats.areaFilter = "59_to_120";
apartments.stats.areaCounts = Object.fromEntries(APARTMENT_AREA_RANGES.map(([range]) => [range, apartments.complexes.filter(complex => complex.areaTags.includes(range)).length]));
prices.generatedAt = provenance.generatedAt;
prices.snapshot = provenance;
prices.refresh = { source: provenance.source, importedSnapshot: true, updatedComplexes };
await Promise.all([
  writeFile(apartmentPath, JSON.stringify(apartments)),
  writeFile(pricePath, JSON.stringify(prices))
]);
console.log(JSON.stringify(prices.refresh, null, 2));
