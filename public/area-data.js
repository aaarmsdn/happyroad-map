export const APARTMENT_AREA_RANGES = [
  ["59-69", 59, 69],
  ["70-79", 70, 79],
  ["80-89", 80, 89],
  ["90-99", 90, 99],
  ["100-109", 100, 109],
  ["110-120", 110, 120]
];

export function areaKey(value) {
  const area = Number(value);
  return Number.isFinite(area) && area >= 59 && area <= 120 ? String(Math.floor(area)) : null;
}

export function areaRange(value) {
  const area = Number(value);
  return APARTMENT_AREA_RANGES.find(([, min, max]) => area >= min && area <= max)?.[0] ?? null;
}

export function isCanonicalAreaKey(value) {
  return /^\d{2,3}$/.test(value) && areaKey(value) === value;
}

export function areaKeysForSelection(areas, selection = "전체") {
  return Object.keys(areas || {}).filter(key => {
    if (!isCanonicalAreaKey(key) || Number(areas[key]?.count) <= 0) return false;
    return selection === "전체" || areaRange(key) === selection || key === selection;
  }).sort((a, b) => Number(a) - Number(b));
}

export function areaTagMatches(tags, selection) {
  return tags.some(tag => tag === selection || areaRange(tag) === selection);
}

export function areaTagsForValues(values) {
  const ranges = new Set(values.map(value => APARTMENT_AREA_RANGES.some(([range]) => range === value) ? value : areaRange(value)).filter(Boolean));
  return APARTMENT_AREA_RANGES.map(([range]) => range).filter(range => ranges.has(range));
}
