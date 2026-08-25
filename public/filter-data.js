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

export function routeRequestForStop(stop, paths, state) {
  const pathKeys = new Set(paths.map(path => path.uidKey));
  const entry = filteredEntries(stop.entries, state).find(item => pathKeys.has(item.uidKey));
  return entry ? { uidKey: entry.uidKey, routeName: entry.routeName } : null;
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
  const currentApiMatch = record?.matchStatus === "matched"
    && ["normalized_name_and_lawd_cd_from_boundary", "configured_alias_and_lawd_cd_from_boundary"].includes(record.matchMethod);
  const pinnedSnapshot = record?.matchStatus === "snapshot"
    && record.matchMethod === "official_snapshot_by_complex_id"
    && /^[a-f0-9]{64}$/.test(prices.snapshot?.sha256);
  if (!/^\d{5}$/.test(expectedRegionCode) || (!currentApiMatch && !pinnedSnapshot) || record.matchRegionCode !== expectedRegionCode) return null;
  return record;
}

function pricePointFor(prices, state, complexId, expectedRegionCode) {
  const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
  if (!record) return null;
  const areas = state.area === "전체" ? ["84", "59", "102", "115"] : [state.area];
  for (const area of areas) {
    const data = record.areas?.[area];
    const median = Number(data?.median);
    if (median > 0) return { area: Number(area), median, perPyeong: Number(data?.medianPerPyeong) || pricePerPyeong(median, area) };
  }
  return null;
}

export function priceFor(prices, state, complexId, expectedRegionCode) {
  return pricePointFor(prices, state, complexId, expectedRegionCode)?.median ?? null;
}

export function pricePerPyeong(amount, area) {
  const price = Number(amount);
  const squareMeters = Number(area);
  return price > 0 && squareMeters > 0 ? Math.round(price * 3.305785 / squareMeters) : null;
}

export function pricePerPyeongFor(prices, state, complexId, expectedRegionCode) {
  if (state.area === "전체") {
    const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
    const exactMedian = Number(record?.medianPerPyeong);
    if (exactMedian > 0) return exactMedian;
    const groups = ["59", "84", "102", "115"].map(area => {
      const data = record?.areas?.[area];
      return { count: Number(data?.count) || 0, value: Number(data?.medianPerPyeong) || pricePerPyeong(data?.median, area) };
    }).filter(group => group.count > 0 && group.value).sort((left, right) => left.value - right.value);
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    if (!total) return null;
    const valueAt = index => groups.find((group, position) => index < groups.slice(0, position + 1).reduce((sum, item) => sum + item.count, 0)).value;
    return total % 2 ? valueAt(Math.floor(total / 2)) : Math.round((valueAt(total / 2 - 1) + valueAt(total / 2)) / 2);
  }
  const point = pricePointFor(prices, state, complexId, expectedRegionCode);
  return point?.perPyeong ?? null;
}

export function priceColor(state, value) {
  if (!state.priceColors || !value) return "#f04438";
  if (value < 2500) return "#18864b";
  if (value < 4000) return "#2774ae";
  if (value < 6000) return "#d6a01d";
  if (value < 8000) return "#f07835";
  return "#d83a3a";
}
