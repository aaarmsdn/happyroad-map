import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { officialRegionCodeFor, prepareDistricts, regionCodeFor } from "./region-match.mjs";

const boundaries = JSON.parse(await readFile(new URL("../config/sgg.json", import.meta.url), "utf8"));
const districts = prepareDistricts(boundaries);

test("apartment coordinates resolve to exact five-digit district codes", () => {
  assert.equal(regionCodeFor({ lat: 37.570979, lng: 126.914758 }, districts), "11410");
  assert.equal(regionCodeFor({ lat: 37.275, lng: 127.45 }, districts), "41500");
  assert.equal(regionCodeFor({ lat: null, lng: null }, districts), null);
});

test("stored legal-region codes override district boundary fallbacks", () => {
  assert.equal(officialRegionCodeFor({ regionCode: "11620", lat: 37.491, lng: 126.927 }, districts), "11620");
  assert.equal(officialRegionCodeFor({ lat: 37.570979, lng: 126.914758 }, districts), "11410");
});
