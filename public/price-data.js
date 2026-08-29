import { areaKeysForSelection } from "./area-data.js?v=1";

export function priceRecordForDisplay(prices, complexId, expectedRegionCode) {
  const record = prices.complexes[complexId];
  const currentApiMatch = record?.matchStatus === "matched"
    && ["normalized_name_and_lawd_cd_from_boundary", "configured_alias_and_lawd_cd_from_boundary", "unique_containment_name_and_lawd_cd_from_boundary"].includes(record.matchMethod);
  if (!/^\d{5}$/.test(expectedRegionCode) || !currentApiMatch || record.matchRegionCode !== expectedRegionCode) return null;
  return record;
}

function pricePointFor(prices, state, complexId, expectedRegionCode) {
  const record = priceRecordForDisplay(prices, complexId, expectedRegionCode);
  if (!record) return null;
  const metric = priceMetric(state.priceMetric);
  return representativeAreaPrice(record, metric, state.area);
}

export function priceFor(prices, state, complexId, expectedRegionCode) {
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

export function representativeAreaPrice(record, metricValue = "max", selectedArea = "전체") {
  const metric = priceMetric(metricValue);
  const point = area => {
    const data = record?.areas?.[area];
    const amount = transactionPrice(data, metric);
    return Number(data?.count) > 0 && amount ? {
      area: Number(area),
      amount,
      perPyeong: transactionPricePerPyeong(data, area, metric),
      count: Number(data.count)
    } : null;
  };
  const areas = areaKeysForSelection(record?.areas, selectedArea);
  if (!areas.length) return null;
  const representativeArea = areas.includes("84") ? "84" : areas.reduce((best, area) => (
    transactionPrice(record?.areas?.[area], "max") > transactionPrice(record?.areas?.[best], "max") ? area : best
  ));
  return point(representativeArea);
}

export function pricePerPyeongFor(prices, state, complexId, expectedRegionCode) {
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
  if (!Number.isFinite(perPyeong)) return "#63717a";
  if (state.apartmentColor === "none") return "#f04438";
  if (state.apartmentColor !== "commute") return priceColor({ priceColors: true }, perPyeong);
  if (!Number.isFinite(roundTripMinutes)) return "#63717a";
  if (roundTripMinutes < 120) return "#18864b";
  if (roundTripMinutes < 150) return "#2774ae";
  if (roundTripMinutes < 180) return "#d6a01d";
  if (roundTripMinutes < 240) return "#f07835";
  return "#d83a3a";
}
