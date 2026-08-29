function ringContains([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function polygonContains(point, rings) {
  return ringContains(point, rings[0]) && !rings.slice(1).some(ring => ringContains(point, ring));
}

function geometryContains(point, geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => polygonContains(point, polygon));
}

export function prepareDistricts(geojson) {
  if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features)) throw new Error("Invalid district boundary GeoJSON");
  return geojson.features.map(feature => {
    const code = String(feature.properties?.sgg || "");
    if (!/^\d{5}$/.test(code) || !["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) throw new Error("Invalid district boundary feature");
    const points = feature.geometry.coordinates.flat(feature.geometry.type === "Polygon" ? 1 : 2);
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    return { code, geometry: feature.geometry, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
}

export function regionCodeFor(complex, districts) {
  const point = [Number(complex.lng), Number(complex.lat)];
  if (!point.every(Number.isFinite)) return null;
  for (const district of districts) {
    const [minX, minY, maxX, maxY] = district.bounds;
    if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue;
    if (geometryContains(point, district.geometry)) return district.code;
  }
  return null;
}

export function officialRegionCodeFor(complex, districts) {
  return /^\d{5}$/.test(String(complex.regionCode || "")) ? complex.regionCode : regionCodeFor(complex, districts);
}
