import { koreaPoint } from "./korea-boundary.js?v=3";

const minutesOf = value => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const MAX_COMMUTE_WAIT_MINUTES = 16 * 60;

const dateAtMinutes = (base, minutes) => {
  const date = new Date(base);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
};

const scheduledDate = (base, minutes, allowNextDay = false) => {
  const date = dateAtMinutes(base, minutes);
  if (date >= base) return date;
  if (!allowNextDay) return null;
  date.setDate(date.getDate() + 1);
  return date;
};

export const isKoreaPoint = koreaPoint;

export function formatShuttleTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "-";
}

function routeGroups(entries, category) {
  const groups = new Map();
  entries.filter(entry => (entry.direction || entry.routeCategory) === category).forEach(entry => {
    if (!groups.has(entry.uidKey)) groups.set(entry.uidKey, []);
    groups.get(entry.uidKey).push(entry);
  });
  return [...groups.values()].map(group => group.sort((a, b) => a.stopOrder - b.stopOrder));
}

export function nextFiveMinuteValue(date = new Date()) {
  const rounded = new Date(Math.ceil(date.getTime() / 300000) * 300000);
  const local = new Date(rounded.getTime() - rounded.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function distanceKm(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function upcomingStopKeys(entries, mode, departureAt, point) {
  const departure = new Date(departureAt);
  if (!Number.isFinite(departure.getTime())) return null;
  const category = mode === "to-company" ? "출근" : "퇴근";
  const keys = new Set();
  const nextDayKeys = new Set();
  routeGroups(entries, category).forEach(group => {
    const company = group.find(entry => entry.isCompany);
    if (!company) return;
    if (mode === "to-company") {
      group.filter(entry => !entry.isCompany).forEach(stop => {
        const minutes = minutesOf(stop.time);
        const shuttleDate = minutes === null ? null : scheduledDate(departure, minutes, true);
        const fastestAccess = Math.max(5, Math.round(distanceKm(point, stop) * 2.4 + 4));
        if (shuttleDate && shuttleDate - departure >= fastestAccess * 60000
          && shuttleDate - departure <= MAX_COMMUTE_WAIT_MINUTES * 60000) {
          const target = shuttleDate.getDate() === departure.getDate() ? keys : nextDayKeys;
          target.add(stop.stationUid || stop.station);
        }
      });
      return;
    }
    const minutes = minutesOf(company.time);
    if (minutes !== null && scheduledDate(departure, minutes)) {
      group.filter(entry => !entry.isCompany && minutesOf(entry.time) !== null).forEach(stop => keys.add(stop.stationUid || stop.station));
    }
  });
  return keys.size ? keys : nextDayKeys;
}

export function nearestShuttleStops(entries, mode, point, limit = 5, departureAt = null) {
  const category = mode === "to-company" ? "출근" : "퇴근";
  const upcoming = departureAt ? upcomingStopKeys(entries, mode, departureAt, point) : null;
  const stops = new Map();
  entries.filter(entry => (entry.direction || entry.routeCategory) === category && !entry.isCompany && (!upcoming || upcoming.has(entry.stationUid || entry.station))).forEach(entry => {
    const key = entry.stationUid || entry.station;
    const candidate = { key, station: entry.station, lat: entry.lat, lng: entry.lng, distanceKm: distanceKm(point, entry) };
    if (!stops.has(key) || candidate.distanceKm < stops.get(key).distanceKm) stops.set(key, candidate);
  });
  return [...stops.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

export function findShuttleCandidates({ entries, mode, point, departureAt, accessMinutesByStop = new Map(), limit = 5 }) {
  const departure = new Date(departureAt);
  if (!Number.isFinite(departure.getTime()) || !point) return [];
  const category = mode === "to-company" ? "출근" : "퇴근";
  const results = [];
  for (const group of routeGroups(entries, category)) {
    const company = group.find(entry => entry.isCompany);
    if (!company) continue;
    if (mode === "to-company") {
      for (const stop of group.filter(entry => !entry.isCompany)) {
        const access = accessMinutesByStop.get(stop.stationUid || stop.station);
        if (!Number.isFinite(access)) continue;
        const shuttleMinutes = minutesOf(stop.time);
        const companyMinutes = minutesOf(company.time) ?? (shuttleMinutes + Number(stop.minutesToCompany || 0));
        if (shuttleMinutes === null || companyMinutes === null) continue;
        const shuttleDate = scheduledDate(departure, shuttleMinutes, true);
        if (!shuttleDate) continue;
        if (shuttleDate - departure > MAX_COMMUTE_WAIT_MINUTES * 60000) continue;
        if (shuttleDate < new Date(departure.getTime() + access * 60000)) continue;
        const arrivalDate = dateAtMinutes(shuttleDate, companyMinutes);
        if (arrivalDate < shuttleDate) arrivalDate.setDate(arrivalDate.getDate() + 1);
        const waitMinutes = Math.round((shuttleDate - departure) / 60000) - access;
        const shuttleDuration = Math.round((arrivalDate - shuttleDate) / 60000);
        results.push({
          uidKey: stop.uidKey, routeName: stop.routeName, station: stop.station,
          shuttleAt: formatShuttleTime(stop.time), arrivalAt: formatShuttleTime(company.time),
          accessMinutes: access, waitMinutes, shuttleMinutes: shuttleDuration,
          totalMinutes: access + waitMinutes + shuttleDuration, stop, company
        });
      }
    } else {
      const companyMinutes = minutesOf(company.time);
      const companyDate = companyMinutes === null ? null : scheduledDate(departure, companyMinutes);
      if (!companyDate) continue;
      for (const stop of group.filter(entry => !entry.isCompany)) {
        const access = accessMinutesByStop.get(stop.stationUid || stop.station);
        const stopMinutes = minutesOf(stop.time);
        if (!Number.isFinite(access) || stopMinutes === null) continue;
        const stopDate = dateAtMinutes(companyDate, stopMinutes);
        if (stopDate < companyDate) stopDate.setDate(stopDate.getDate() + 1);
        const waitMinutes = Math.round((companyDate - departure) / 60000);
        const shuttleDuration = Math.round((stopDate - companyDate) / 60000);
        results.push({
          uidKey: stop.uidKey, routeName: stop.routeName, station: stop.station,
          shuttleAt: formatShuttleTime(company.time), arrivalAt: formatShuttleTime(stop.time),
          accessMinutes: access, waitMinutes, shuttleMinutes: shuttleDuration,
          totalMinutes: waitMinutes + shuttleDuration + access, stop, company
        });
      }
    }
  }
  return results.sort((a, b) => a.totalMinutes - b.totalMinutes || a.accessMinutes - b.accessMinutes).slice(0, limit);
}

const ACCESS_PROFILES = [
  { mode: "walk", label: "도보", limit: 1, stopLimit: 12 },
  { mode: "car", label: "택시", limit: 1, stopLimit: 3 },
  { mode: "public-transit", label: "대중교통", limit: 3, stopLimit: 12 }
];
const MAX_ROUTE_ENDPOINT_GAP_KM = 0.1;
const MAX_TRANSIT_ENDPOINT_GAP_KM = 3;

function hasDrawableRoutePoints(points, start, end, mode) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const valid = points.every(point => Array.isArray(point) && point.length >= 2
    && Number.isFinite(point[0]) && Math.abs(point[0]) <= 90
    && Number.isFinite(point[1]) && Math.abs(point[1]) <= 180);
  if (!valid || !points.slice(1).some(point => point[0] !== points[0][0] || point[1] !== points[0][1])) return false;
  const first = { lat: points[0][0], lng: points[0][1] };
  const last = { lat: points.at(-1)[0], lng: points.at(-1)[1] };
  const maximumGap = mode === "public-transit" ? MAX_TRANSIT_ENDPOINT_GAP_KM : MAX_ROUTE_ENDPOINT_GAP_KM;
  return distanceKm(start, first) <= maximumGap && distanceKm(end, last) <= maximumGap;
}

export async function accessRoutesFor({ stops, direction, point, apiBase, fetcher = fetch, signal }) {
  const routesByMode = new Map(ACCESS_PROFILES.map(profile => [profile.mode, new Map()]));
  if (!isKoreaPoint(point)) return routesByMode;
  const koreaStops = stops.filter(stop => isKoreaPoint(stop));
  const requests = [];
  ACCESS_PROFILES.forEach(profile => {
    const profileStops = koreaStops.slice(0, profile.stopLimit);
    profileStops.forEach(stop => {
      const stopPoint = { lat: stop.lat, lng: stop.lng };
      const start = direction === "to-company" ? point : stopPoint;
      const end = direction === "to-company" ? stopPoint : point;
      requests.push({ id: requests.length, mode: profile.mode, stop, start, end });
    });
  });
  if (!apiBase || !requests.length) return routesByMode;
  try {
    const response = await fetcher(`${apiBase}/routes`, {
      method: "POST", headers: { "content-type": "application/json" }, signal,
      body: JSON.stringify({ routes: requests.map(({ id, mode, start, end }) => ({ id, mode, start, end })) })
    });
    if (!response.ok) throw new Error(response.status === 429 ? "route_rate_limited" : "route_api_unavailable");
    const results = (await response.json()).routes || [];
    results.forEach(result => {
      const request = requests[result.id];
      const route = result.route;
      if (!request || !route || !Number.isFinite(route.minutes) || route.minutes <= 0
        || !hasDrawableRoutePoints(route.points, request.start, request.end, request.mode)) return;
      const connectors = request.mode === "public-transit" ? [
        [[request.start.lat, request.start.lng], route.points[0]],
        [route.points.at(-1), [request.end.lat, request.end.lng]]
      ].filter(([from, to]) => from[0] !== to[0] || from[1] !== to[1]) : [];
      routesByMode.get(request.mode).set(request.stop.key, { ...route, connectors, estimated: false, scheduleBasis: "current" });
    });
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
  }
  return routesByMode;
}

export function recommendCommuteJourneys({ entries, mode, point, departureAt, accessMinutesByMode, acceptJourney = () => true, limit = 5 }) {
  const journeys = ACCESS_PROFILES.flatMap(profile => {
    const accessRoutes = accessMinutesByMode.get(profile.mode) || new Map();
    const accessMinutesByStop = new Map([...accessRoutes].map(([key, route]) => [key, Number(route?.minutes ?? route)]));
    return findShuttleCandidates({ entries, mode, point, departureAt, accessMinutesByStop, limit: entries.length })
      .map(journey => {
        const access = accessRoutes.get(journey.stop.stationUid || journey.stop.station);
        return {
          ...journey,
          accessMode: profile.mode,
          accessLabel: profile.label,
          accessEstimated: typeof access === "number" || access?.estimated !== false,
          accessFare: Number(access?.fare || 0),
          accessTransfers: Number(access?.transfers || 0),
          accessDistanceMeters: Number(access?.distanceMeters || 0),
          accessRoute: typeof access === "object" ? access : null,
          direction: mode
        };
      })
      .filter(acceptJourney)
      .sort((left, right) => profile.mode === "walk"
        ? Number(left.accessDistanceMeters > 1200) - Number(right.accessDistanceMeters > 1200)
          || left.totalMinutes - right.totalMinutes || left.accessDistanceMeters - right.accessDistanceMeters
        : left.totalMinutes - right.totalMinutes)
      .slice(0, profile.limit);
  });
  return journeys.slice(0, limit);
}
