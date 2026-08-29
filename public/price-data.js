export function priceRecordForDisplay(prices, complexId, expectedRegionCode) {
  const record = prices.complexes[complexId];
  const currentApiMatch = record?.matchStatus === "matched"
    && ["normalized_name_and_lawd_cd_from_boundary", "configured_alias_and_lawd_cd_from_boundary", "unique_containment_name_and_lawd_cd_from_boundary"].includes(record.matchMethod);
  const pinnedSnapshot = record?.matchStatus === "snapshot"
    && record.matchMethod === "official_snapshot_by_complex_id"
    && /^[a-f0-9]{64}$/.test(prices.snapshot?.sha256);
  if (!/^\d{5}$/.test(expectedRegionCode) || (!currentApiMatch && !pinnedSnapshot) || record.matchRegionCode !== expectedRegionCode) return null;
  return record;
}

function pricePointFor(prices, state, complexId, expectedRegionCode) {
  const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
  if (!record) return null;
  const metric = priceMetric(state.priceMetric);
  const areas = state.area === "전체" ? ["84", "59", "102", "115"] : [state.area];
  for (const area of areas) {
    const data = record.areas?.[area];
    const amount = transactionPrice(data, metric);
    if (amount) return { area: Number(area), amount, perPyeong: transactionPricePerPyeong(data, area, metric) };
  }
  return null;
}

export function priceFor(prices, state, complexId, expectedRegionCode) {
  if (state.area === "전체") {
    const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
    return overallTransactionPrice(record, state.priceMetric);
  }
  return pricePointFor(prices, state, complexId, expectedRegionCode)?.amount ?? null;
}

export function pricePerPyeong(amount, area) {
  const price = Number(amount);
  const squareMeters = Number(area);
  return price > 0 && squareMeters > 0 ? Math.round(price * 3.305785 / squareMeters) : null;
}

export function priceMetric(value) {
  return ["max", "average", "min"].includes(value) ? value : "max";
}

export function transactionPrice(data, metricValue = "max") {
  const metric = priceMetric(metricValue);
  const value = Number(data?.[metric]);
  return value > 0 ? value : null;
}

export function transactionPricePerPyeong(data, area, metricValue = "max") {
  const metric = priceMetric(metricValue);
  const exact = Number(data?.[`${metric}PerPyeong`]);
  if (exact > 0) return exact;
  return pricePerPyeong(transactionPrice(data, metric), area);
}

function aggregateMetric(groups, metric) {
  if (!groups.length) return null;
  if (metric === "max") return Math.max(...groups.map(group => group.value));
  if (metric === "min") return Math.min(...groups.map(group => group.value));
  const count = groups.reduce((sum, group) => sum + group.count, 0);
  return Math.round(groups.reduce((sum, group) => sum + group.value * group.count, 0) / count);
}

export function overallTransactionPrice(record, metricValue = "max") {
  const metric = priceMetric(metricValue);
  const exact = transactionPrice(record, metric);
  if (exact) return exact;
  const groups = Object.values(record?.areas || {}).map(data => ({
    count: Number(data?.count) || 0,
    value: transactionPrice(data, metric)
  })).filter(group => group.count > 0 && group.value);
  return aggregateMetric(groups, metric);
}

export function overallTransactionPricePerPyeong(record, metricValue = "max") {
  const metric = priceMetric(metricValue);
  const exact = Number(record?.[`${metric}PerPyeong`]);
  if (exact > 0) return exact;
  const groups = Object.entries(record?.areas || {}).map(([area, data]) => ({
    count: Number(data?.count) || 0,
    value: transactionPricePerPyeong(data, area, metric)
  })).filter(group => group.count > 0 && group.value);
  return aggregateMetric(groups, metric);
}

export function pricePerPyeongFor(prices, state, complexId, expectedRegionCode) {
  if (state.area === "전체") {
    const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
    return overallTransactionPricePerPyeong(record, state.priceMetric);
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

export function apartmentColor(state, perPyeong, roundTripMinutes) {
  if (state.apartmentColor === "none") return "#f04438";
  if (state.apartmentColor !== "commute") return priceColor({ priceColors: true }, perPyeong);
  if (!Number.isFinite(roundTripMinutes)) return "#63717a";
  if (roundTripMinutes < 120) return "#18864b";
  if (roundTripMinutes < 150) return "#2774ae";
  if (roundTripMinutes < 180) return "#d6a01d";
  if (roundTripMinutes < 240) return "#f07835";
  return "#d83a3a";
}
