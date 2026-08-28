const LEVEL_KEYS = ["elementary", "middle", "high"];

export function distanceKm(a, b) {
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearestSchools(schools, point, count = 3) {
  const result = Object.fromEntries(LEVEL_KEYS.map(level => [level, []]));
  for (const school of schools) {
    if (!result[school.level] || !Number.isFinite(school.lat) || !Number.isFinite(school.lng)) continue;
    result[school.level].push({ ...school, distanceKm: distanceKm(point, school) });
  }
  for (const level of LEVEL_KEYS) result[level] = result[level].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, count);
  return result;
}
