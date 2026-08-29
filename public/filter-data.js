import { hourOf } from "./filter-logic.js?v=12";
import { normalize } from "./ui-utils.js?v=10";
import { areaTagMatches } from "./area-data.js?v=1";

export function entryMatches(entry, state) {
  const query = normalize(state.routeQuery);
  return (state.category === "전체" || entry.routeCategory === state.category)
    && (state.routeType === "전체" || entry.routeType === state.routeType)
    && (!state.startHour || hourOf(entry.turnStartTime || entry.time) === state.startHour)
    && (!query || normalize(`${entry.routeName} ${entry.station} ${entry.turnName}`).includes(query));
}

export function filteredEntries(entries, state) {
  return entries.filter(entry => entryMatches(entry, state) && (state.route === "전체" || entry.routeName === state.route));
}

export function routeRequestForStop(stop, paths, state) {
  const pathKeys = new Set(paths.map(path => path.uidKey));
  const entry = filteredEntries(stop.entries, state).find(item => pathKeys.has(item.uidKey));
  return entry ? { uidKey: entry.uidKey, routeName: entry.routeName } : null;
}

export function directionsByStation(entries) {
  const result = new Map();
  for (const entry of entries) {
    if (!entry.stationUid) continue;
    if (!result.has(entry.stationUid)) result.set(entry.stationUid, new Set());
    if (entry.direction === "출근" || entry.direction === "퇴근") result.get(entry.stationUid).add(entry.direction);
  }
  return result;
}

function shuttleClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function adjustedClock(value, offset = 0) {
  const minutes = shuttleClockMinutes(value);
  if (!Number.isFinite(minutes) || minutes === Number.MAX_SAFE_INTEGER) return null;
  const normalized = ((minutes + offset) % 1440 + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function closestTimedEntry(entries, targetMinutes) {
  return entries.slice().sort((left, right) => Math.abs(shuttleClockMinutes(left.companyTime) - targetMinutes) - Math.abs(shuttleClockMinutes(right.companyTime) - targetMinutes))[0];
}

export function apartmentStopTimings(entries) {
  const valid = (category, field) => entries.filter(entry => {
    const minutes = entry[field] === null || entry[field] === "" || entry[field] === undefined ? NaN : Number(entry[field]);
    return (entry.direction || entry.routeCategory) === category && Number.isFinite(minutes) && minutes >= 0;
  });
  const inbound = valid("출근", "minutesToCompany");
  const outbound = valid("퇴근", "minutesFromCompany");
  const normalInbound = closestTimedEntry(inbound.filter(entry => String(entry.turnName).includes("통상 출근")), 8 * 60);
  const normalOutbound = closestTimedEntry(outbound.filter(entry => String(entry.turnName).includes("통상 18시퇴근")), 18 * 60);
  const selectedInbound = normalInbound || closestTimedEntry(inbound, 8 * 60);
  const selectedOutbound = normalOutbound || closestTimedEntry(outbound, 18 * 60);
  const fallbacks = [];
  if (selectedInbound && !normalInbound) fallbacks.push(selectedInbound.turnName || selectedInbound.routeName);
  if (selectedOutbound && !normalOutbound) fallbacks.push(selectedOutbound.turnName || selectedOutbound.routeName);
  if (selectedInbound?.timeEstimated || selectedOutbound?.timeEstimated) fallbacks.push("도착시간 추정");
  const fallbackNames = [...new Set(fallbacks.filter(Boolean))];
  const inboundMinutes = selectedInbound ? Math.round(Number(selectedInbound.minutesToCompany)) : null;
  const outboundMinutes = selectedOutbound ? Math.round(Number(selectedOutbound.minutesFromCompany)) : null;
  const inboundCompanyAt = selectedInbound ? adjustedClock(selectedInbound.companyTime) : null;
  const outboundCompanyAt = selectedOutbound ? adjustedClock(selectedOutbound.companyTime) : null;
  return {
    inboundMinutes,
    outboundMinutes,
    inboundStopAt: selectedInbound ? adjustedClock(selectedInbound.time) || adjustedClock(selectedInbound.companyTime, -inboundMinutes) : null,
    inboundCompanyAt,
    outboundCompanyAt,
    outboundStopAt: selectedOutbound ? adjustedClock(selectedOutbound.time) || adjustedClock(selectedOutbound.companyTime, outboundMinutes) : null,
    fallbackLabel: fallbackNames.length ? `${fallbackNames.join(" · ")} 기준` : ""
  };
}

function hasDirectionMinutes(entry, direction) {
  const field = direction === "출근" ? "minutesToCompany" : "minutesFromCompany";
  const value = entry[field];
  return value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function apartmentLinkEntries(link, stations) {
  const directions = new Set(link?.directions || []);
  const routes = new Set(link?.routes || []);
  const entries = (stations.get(link?.stationId)?.entries || []).filter(entry => {
    const direction = entry.direction || entry.routeCategory;
    return !directions.size || directions.has(direction);
  });
  if (!routes.size) return entries;
  const preferred = new Set(["출근", "퇴근"].filter(direction => entries.some(entry => {
    return (entry.direction || entry.routeCategory) === direction && routes.has(entry.routeName) && hasDirectionMinutes(entry, direction);
  })));
  return entries.filter(entry => {
    const direction = entry.direction || entry.routeCategory;
    return routes.has(entry.routeName) || !preferred.has(direction);
  });
}

export function apartmentLinkTimings(link, stations) {
  return apartmentStopTimings(apartmentLinkEntries(link, stations));
}

export function apartmentDoorTimes(timing, distanceKm) {
  const walking = Number.isFinite(Number(distanceKm)) ? Math.max(0, Math.ceil(Number(distanceKm) * 12.5)) : 0;
  return {
    leaveHomeAt: timing.inboundStopAt ? adjustedClock(timing.inboundStopAt, -walking) : null,
    arriveHomeAt: timing.outboundStopAt ? adjustedClock(timing.outboundStopAt, walking) : null
  };
}

export function apartmentCommuteTimes(links, stations, maxDistance = Infinity, includeWalking = true) {
  let inbound = null;
  let outbound = null;
  const candidates = (links || []).filter(link => Number(link.distanceKm) <= maxDistance).map(link => ({
    link,
    entries: apartmentLinkEntries(link, stations)
  }));
  const hasNormalInbound = candidates.some(({ entries }) => entries.some(entry => {
    return String(entry.turnName).includes("통상 출근") && hasDirectionMinutes(entry, "출근");
  }));
  const hasNormalOutbound = candidates.some(({ entries }) => entries.some(entry => {
    return String(entry.turnName).includes("통상 18시퇴근") && hasDirectionMinutes(entry, "퇴근");
  }));
  for (const { link, entries } of candidates) {
    const timing = apartmentStopTimings(entries);
    const walkingMinutes = includeWalking ? Math.max(0, Math.ceil(Number(link.distanceKm) * 12.5)) : 0;
    const normalInbound = entries.some(entry => String(entry.turnName).includes("통상 출근") && hasDirectionMinutes(entry, "출근"));
    const normalOutbound = entries.some(entry => String(entry.turnName).includes("통상 18시퇴근") && hasDirectionMinutes(entry, "퇴근"));
    if (Number.isFinite(timing.inboundMinutes) && (!hasNormalInbound || normalInbound)) {
      const candidate = { shuttleMinutes: timing.inboundMinutes, walkingMinutes, totalMinutes: timing.inboundMinutes + walkingMinutes, stationId: link.stationId };
      if (!inbound || candidate.totalMinutes < inbound.totalMinutes) inbound = candidate;
    }
    if (Number.isFinite(timing.outboundMinutes) && (!hasNormalOutbound || normalOutbound)) {
      const candidate = { shuttleMinutes: timing.outboundMinutes, walkingMinutes, totalMinutes: timing.outboundMinutes + walkingMinutes, stationId: link.stationId };
      if (!outbound || candidate.totalMinutes < outbound.totalMinutes) outbound = candidate;
    }
  }
  return { inbound, outbound, roundTripMinutes: inbound && outbound ? inbound.totalMinutes + outbound.totalMinutes : null };
}

export function apartmentRoundTripMinutes(links, stations, maxDistance = Infinity, includeWalking = true) {
  return apartmentCommuteTimes(links, stations, maxDistance, includeWalking).roundTripMinutes;
}

export function prioritizeCommuteLinks(links, commute) {
  const selected = new Set([commute?.inbound?.stationId, commute?.outbound?.stationId].filter(Boolean));
  return (links || []).slice().sort((left, right) => Number(selected.has(right.stationId)) - Number(selected.has(left.stationId)) || left.distanceKm - right.distanceKm);
}

export function stopRepresentativeMinutes(entries) {
  const timing = apartmentStopTimings(entries);
  const values = [timing.inboundMinutes, timing.outboundMinutes].filter(Number.isFinite);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

export function matchingApartmentLinks(links, state, stationDirections, complexById, stations, activeEntries) {
  const result = new Map();
  const linksByComplex = new Map();
  if (!state.area) return result;
  for (const link of links) {
    if (link.distanceKm > state.distance) continue;
    const complex = complexById.get(link.complexId);
    if (!complex || complex.households < state.households) continue;
    if (state.area !== "전체" && !areaTagMatches(complex.areaTags, state.area)) continue;
    if (!stationDirections.has(link.stationId)) continue;
    if (!linksByComplex.has(link.complexId)) linksByComplex.set(link.complexId, []);
    linksByComplex.get(link.complexId).push(link);
    const previous = result.get(link.complexId);
    const directions = new Set(previous?.accessDirections);
    for (const direction of stationDirections.get(link.stationId)) directions.add(direction);
    const nearest = !previous || link.distanceKm < previous.distanceKm ? link : previous;
    result.set(link.complexId, {
      ...nearest,
      accessDirections: ["출근", "퇴근"].filter(direction => directions.has(direction))
    });
  }
  if (!state.inboundTime && !state.outboundTime) return result;
  const timingStations = activeEntries ? new Map() : stations;
  for (const entry of activeEntries || []) {
    if (!entry.stationUid) continue;
    if (!timingStations.has(entry.stationUid)) timingStations.set(entry.stationUid, { entries: [] });
    timingStations.get(entry.stationUid).entries.push(entry);
  }
  for (const [complexId] of result) {
    const commute = apartmentCommuteTimes(linksByComplex.get(complexId), timingStations, state.distance, state.includeWalking !== false);
    if ((state.inboundTime && (!commute.inbound || commute.inbound.totalMinutes > state.inboundTime))
      || (state.outboundTime && (!commute.outbound || commute.outbound.totalMinutes > state.outboundTime))) result.delete(complexId);
  }
  return result;
}

export { apartmentColor, priceColor, priceFor, priceMetric, pricePerPyeong, pricePerPyeongFor, priceRecordForDisplay, representativeAreaPrice, transactionPrice, transactionPricePerPyeong } from "./price-data.js?v=3";
