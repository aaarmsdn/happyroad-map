import { koreaPoint } from "../../public/korea-boundary.js";

export { koreaPoint };

const safeText = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const MAX_ROUTE_ENDPOINT_GAP_KM = 0.1;
const MAX_TRANSIT_ENDPOINT_GAP_KM = 3;

const pointDistanceKm = (point, target) => {
  const radians = Math.PI / 180;
  const north = (point[0] - target[0]) * 111.195;
  const east = (point[1] - target[1]) * 111.195 * Math.cos((point[0] + target[0]) * radians / 2);
  return Math.hypot(north, east);
};

function routePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  const points = rawPoints.length <= 500 ? rawPoints : Array.from({ length: 500 }, (_, index) => rawPoints[Math.round(index * (rawPoints.length - 1) / 499)]);
  return points.map(point => {
    const lng = Array.isArray(point) ? Number(point[0]) : Number(point?.x ?? point?.lng);
    const lat = Array.isArray(point) ? Number(point[1]) : Number(point?.y ?? point?.lat);
    return koreaPoint({ lat, lng }) ? [lat, lng] : null;
  }).filter(Boolean).filter((point, index, valid) => !index || point[0] !== valid[index - 1][0] || point[1] !== valid[index - 1][1]);
}

function endpointsMatch(points, start, end, mode) {
  const maximumGap = mode === "public-transit" ? MAX_TRANSIT_ENDPOINT_GAP_KM : MAX_ROUTE_ENDPOINT_GAP_KM;
  return pointDistanceKm(points[0], [start.lat, start.lng]) <= maximumGap
    && pointDistanceKm(points.at(-1), [end.lat, end.lng]) <= maximumGap;
}

function transitStep(step, mode) {
  const properties = step?.properties || step?.summary || {};
  const rawType = safeText(properties.type || step?.type || mode).toLowerCase();
  const type = rawType.includes("subway") ? "subway" : rawType.includes("bus") ? "bus" : "walk";
  const stations = Array.isArray(properties.stops) ? properties.stops : Array.isArray(step?.stations) ? step.stations : [];
  const vehicles = Array.isArray(properties.vehicles) ? properties.vehicles : step?.vehicles || [];
  const vehicle = safeText(vehicles[0]?.name || vehicles[0]?.text || step?.vehicle?.name);
  const startStop = safeText(stations[0]?.name || properties.startName);
  const endStop = safeText(stations.at(-1)?.name || properties.endName);
  const guidance = safeText(properties.guidance) || [vehicle, startStop && endStop ? `${startStop} → ${endStop}` : ""].filter(Boolean).join(" · ") || (type === "walk" ? "도보 이동" : "대중교통 이동");
  const result = {
    type,
    guidance,
    minutes: Math.max(1, Math.ceil(safeNumber(properties.time ?? properties.totalTime ?? properties.duration) / 60)),
    distanceMeters: Math.round(safeNumber(properties.distance ?? properties.totalDistance))
  };
  if (vehicle) result.vehicle = vehicle;
  if (startStop) result.startStop = startStop;
  if (endStop) result.endStop = endStop;
  if (stations.length) result.stopCount = stations.length;
  return result;
}

function carDetails(route) {
  const sections = Array.isArray(route?.sections) ? route.sections : [];
  const rawPoints = sections.flatMap(section => (section.roads || []).flatMap(road => {
    const values = Array.isArray(road.vertexes) ? road.vertexes : [];
    const pairs = [];
    for (let index = 0; index + 1 < values.length; index += 2) pairs.push([values[index], values[index + 1]]);
    return pairs;
  }));
  const steps = sections.flatMap(section => (section.guides || []).map(guide => ({
    type: "car",
    guidance: safeText(guide.name || guide.guidance) || "차량 이동",
    minutes: Math.max(1, Math.ceil(safeNumber(guide.duration) / 60)),
    distanceMeters: Math.round(safeNumber(guide.distance))
  }))).slice(0, 40);
  return { points: routePoints(rawPoints), steps };
}

function accessDetails(route, mode) {
  if (mode === "car") return carDetails(route);
  const steps = (route?.steps || route?.legs?.flatMap(leg => leg.steps || []) || []).slice(0, 40);
  return {
    points: routePoints(steps.flatMap(step => step?.path?.points || step?.points || [])),
    steps: steps.map(step => transitStep(step, mode))
  };
}

function reconcileStepMinutes(steps, totalMinutes, mode) {
  if (!steps.length) return [{ type: mode === "public-transit" ? "walk" : mode, guidance: "이동", minutes: totalMinutes, distanceMeters: 0 }];
  const current = steps.reduce((sum, step) => sum + step.minutes, 0);
  if (current < totalMinutes) {
    const remainder = totalMinutes - current;
    if (mode === "public-transit") return [...steps, {
      type: "walk", guidance: "환승·승하차 및 연결 이동", minutes: remainder, distanceMeters: 0
    }];
    steps.at(-1).minutes += remainder;
  } else if (current > totalMinutes) {
    let excess = current - totalMinutes;
    for (let index = steps.length - 1; index >= 0 && excess; index -= 1) {
      const reduction = Math.min(steps[index].minutes, excess);
      steps[index].minutes -= reduction;
      excess -= reduction;
    }
  }
  return steps;
}

export function routeResult(payload, mode, start, end) {
  const route = payload?.routes?.[0] || payload?.route;
  const properties = route?.properties || route?.summary;
  const seconds = Number(properties?.totalTime ?? properties?.duration);
  if (!route || !Number.isFinite(seconds) || seconds <= 0) return null;
  const details = accessDetails(route, mode);
  if (details.points.length < 2 || !endpointsMatch(details.points, start, end, mode)) return null;
  if (mode === "public-transit" && !details.steps.some(step => ["bus", "subway"].includes(step.type) && step.guidance !== "대중교통 이동")) return null;
  const minutes = Math.ceil(seconds / 60);
  details.steps = reconcileStepMinutes(details.steps, minutes, mode);
  const reportedDistance = safeNumber(properties.totalDistance ?? properties.distance);
  const measuredDistance = details.points.slice(1).reduce((total, point, index) => total + pointDistanceKm(details.points[index], point), 0) * 1000;
  return {
    minutes,
    transfers: Number(properties.transfers || 0),
    fare: Number(mode === "car" ? properties.fare?.taxi : mode === "public-transit" ? properties.fare?.value : 0) || 0,
    distanceMeters: Math.round(reportedDistance > 0 ? reportedDistance : measuredDistance),
    points: details.points,
    steps: details.steps
  };
}
