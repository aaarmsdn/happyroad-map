export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export function addRoutePaths({ L, layer, paths }) {
  let rendered = 0;
  for (const path of paths) {
    const points = decodePolyline(path.encoded);
    if (!points.length) continue;
    L.polyline(points, { color: "#ffffff", weight: 10, opacity: 0.94, interactive: false }).addTo(layer);
    L.polyline(points, { color: "#7d4cc2", weight: 6, opacity: 1, interactive: false }).addTo(layer);
    rendered += 1;
  }
  return rendered;
}

function pointDistance(left, right) {
  return (left[0] - right.lat) ** 2 + (left[1] - right.lng) ** 2;
}

function pointDistanceKm(left, right) {
  const radians = Math.PI / 180;
  const latitude = (left[0] + right.lat) * radians / 2;
  const north = (left[0] - right.lat) * 111.195;
  const east = (left[1] - right.lng) * 111.195 * Math.cos(latitude);
  return Math.hypot(north, east);
}

function nearestPointIndex(points, target, from = 0) {
  let nearest = from;
  for (let index = from + 1; index < points.length; index += 1) {
    if (pointDistance(points[index], target) < pointDistance(points[nearest], target)) nearest = index;
  }
  return nearest;
}

function orderedStopIndices(points, stops) {
  if (!stops.length) return [];
  let costs = points.map(point => pointDistance(point, stops[0]));
  const parents = [];
  for (let stopIndex = 1; stopIndex < stops.length; stopIndex += 1) {
    const nextCosts = new Float64Array(points.length);
    const parent = new Int32Array(points.length);
    let bestCost = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      if (costs[pointIndex] < bestCost) {
        bestCost = costs[pointIndex];
        bestIndex = pointIndex;
      }
      nextCosts[pointIndex] = bestCost + pointDistance(points[pointIndex], stops[stopIndex]);
      parent[pointIndex] = bestIndex;
    }
    costs = nextCosts;
    parents.push(parent);
  }
  let pointIndex = costs.reduce((best, cost, index) => cost < costs[best] ? index : best, 0);
  const indices = Array(stops.length);
  indices[stops.length - 1] = pointIndex;
  for (let stopIndex = stops.length - 1; stopIndex > 0; stopIndex -= 1) {
    pointIndex = parents[stopIndex - 1][pointIndex];
    indices[stopIndex - 1] = pointIndex;
  }
  return indices;
}

export function routeSegmentSourcePoints(encoded, start, end, routeStops = []) {
  const points = decodePolyline(encoded || "");
  if (!points.length || !start || !end) return [];
  const orderedStops = [...routeStops].sort((left, right) => left.stopOrder - right.stopOrder);
  const stopIndices = new Map();
  orderedStopIndices(points, orderedStops).forEach((pointIndex, stopIndex) => {
    stopIndices.set(orderedStops[stopIndex].stopOrder, pointIndex);
  });
  const startIndex = stopIndices.get(start.stopOrder) ?? nearestPointIndex(points, start);
  const endIndex = stopIndices.get(end.stopOrder) ?? nearestPointIndex(points, end);
  return startIndex <= endIndex
    ? points.slice(startIndex, endIndex + 1)
    : points.slice(endIndex, startIndex + 1).reverse();
}

export function routeSegmentPoints(encoded, start, end, routeStops = []) {
  const segment = routeSegmentSourcePoints(encoded, start, end, routeStops);
  if (!segment.length) return [];
  if (pointDistanceKm(segment[0], start) > 0.5 || pointDistanceKm(segment.at(-1), end) > 0.5) return [];
  const exactStart = [start.lat, start.lng];
  const exactEnd = [end.lat, end.lng];
  if (pointDistance(segment[0], start) > 1e-12) segment.unshift(exactStart);
  if (pointDistance(segment.at(-1), end) > 1e-12) segment.push(exactEnd);
  return segment;
}

const accessColors = { walk: "#18864b", car: "#f07835", "public-transit": "#2774ae" };

function addJourneyLine(L, layer, points, color, dashed = false) {
  if (!Array.isArray(points) || points.length < 2) return false;
  L.polyline(points, { color: "#ffffff", weight: dashed ? 7 : 10, opacity: 0.94, interactive: false }).addTo(layer);
  L.polyline(points, { color, weight: dashed ? 3 : 6, opacity: 1, dashArray: dashed ? "5 7" : undefined, interactive: false }).addTo(layer);
  return true;
}

export function addJourneyPaths({ L, layer, path, start, end, routeStops, accessMode, accessPoints, accessConnectors = [] }) {
  let rendered = 0;
  if (addJourneyLine(L, layer, accessPoints, accessColors[accessMode] || accessColors.walk)) rendered += 1;
  accessConnectors.forEach(points => { if (addJourneyLine(L, layer, points, accessColors[accessMode] || accessColors.walk, true)) rendered += 1; });
  if (addJourneyLine(L, layer, routeSegmentPoints(path?.encoded, start, end, routeStops), "#7d4cc2")) rendered += 1;
  return rendered;
}
