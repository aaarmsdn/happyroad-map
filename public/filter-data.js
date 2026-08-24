import { hourOf } from "./filter-logic.js?v=7";
import { normalize } from "./ui-utils.js?v=10";

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

export function matchingApartmentLinks(links, state, routeNames, complexById) {
  const result = new Map();
  for (const link of links) {
    if (link.distanceKm > state.distance) continue;
    if (state.travelTime && (!link.travelMinutes || link.travelMinutes > state.travelTime)) continue;
    if (link.routes.length && !link.routes.some(route => routeNames.has(route))) continue;
    const complex = complexById.get(link.complexId);
    if (!complex || complex.households < state.households) continue;
    if (state.area !== "전체" && !complex.areaTags.includes(state.area)) continue;
    const previous = result.get(link.complexId);
    if (!previous || link.distanceKm < previous.distanceKm) result.set(link.complexId, link);
  }
  return result;
}

export function priceRecordForDisplay(prices, complexId, expectedRegionCode) {
  const record = prices.complexes[complexId];
  const currentApiMatch = record?.matchStatus === "matched" && record.matchMethod === "normalized_name_and_lawd_cd_from_boundary";
  const pinnedSnapshot = record?.matchStatus === "snapshot"
    && record.matchMethod === "official_snapshot_by_complex_id"
    && /^[a-f0-9]{64}$/.test(prices.snapshot?.sha256);
  if (!/^\d{5}$/.test(expectedRegionCode) || (!currentApiMatch && !pinnedSnapshot) || record.matchRegionCode !== expectedRegionCode) return null;
  return record;
}

export function priceFor(prices, state, complexId, expectedRegionCode) {
  const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
  if (!record) return null;
  const areas = state.area === "전체" ? ["84", "59", "102", "115"] : [state.area];
  for (const area of areas) {
    const median = Number(record.areas?.[area]?.median);
    if (median > 0) return median;
  }
  return null;
}

export function priceColor(state, value) {
  if (!state.priceColors || !value) return "#f04438";
  if (value < 40000) return "#1a9a62";
  if (value < 70000) return "#d6a01d";
  if (value < 100000) return "#f07835";
  return "#d83a3a";
}
