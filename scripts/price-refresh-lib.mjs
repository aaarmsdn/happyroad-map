export function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\((?:주상복합|고층|중층|저층)\)/g, "")
    .replace(/이-?편한세상/g, "e편한세상")
    .replace(/아파트|주상복합|apt/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function comparableName(value) {
  return normalizeName(value)
    .replaceAll("에스케이", "sk")
    .replaceAll("엘지", "lg")
    .replace(/(\d+)(?:차|단지)/g, "$1");
}

export function numberSignature(value) {
  return normalizeName(value).match(/\d+/g)?.join(":") || "";
}

export function unmatchedNameReason(exactIds, aliasIds) {
  return exactIds.length || aliasIds.length ? "region_mismatch" : "name_not_found";
}

export function addressIdentityKey(regionCode, legalDong, jibun) {
  const region = String(regionCode || "").trim();
  const dong = String(legalDong || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const lot = String(jibun || "").normalize("NFKC").trim().replace(/\d+/g, value => String(Number(value)));
  return /^\d{5}$/.test(region) && dong && /^(?:산)?\d+(?:-\d+)?$/.test(lot) ? `${region}|${dong}|${lot}` : null;
}

export function uniqueParcelIdentity(matches, parcelRows) {
  return matches.length === 1 && parcelRows.length === 1 ? matches[0] : null;
}

export function safeParcelRows(chosen, rowsByPnu, allowShared = false) {
  const chosenIds = new Set(chosen.map(row => row.id));
  return chosen.filter(row => {
    const parcelRows = rowsByPnu.get(row.pnu) || [];
    return parcelRows.length === 1 || (allowShared && parcelRows.length > 1 && parcelRows.every(candidate => chosenIds.has(candidate.id)));
  });
}

export function eligibleAddressIds(ids, tradeKey, addressesByComplex) {
  return ids.filter(id => !addressesByComplex.has(id) || Boolean(tradeKey && addressesByComplex.get(id).has(tradeKey)));
}

export function xmlValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return match?.[1]?.trim()
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"') ?? "";
}

function validTradeDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function parseTrades(xml) {
  // ponytail: API XML is flat today; replace with an XML parser if nested item fields are introduced.
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const item = match[1];
    const year = xmlValue(item, "dealYear");
    const month = xmlValue(item, "dealMonth").padStart(2, "0");
    const day = xmlValue(item, "dealDay").padStart(2, "0");
    return {
      name: xmlValue(item, "aptNm"),
      legalDong: xmlValue(item, "umdNm"),
      jibun: xmlValue(item, "jibun"),
      roadName: xmlValue(item, "roadNm"),
      roadMain: xmlValue(item, "roadNmBonbun"),
      roadSub: xmlValue(item, "roadNmBubun"),
      buildYear: Number(xmlValue(item, "buildYear")) || null,
      area: Number(xmlValue(item, "excluUseAr")),
      amount: Number(xmlValue(item, "dealAmount").replaceAll(",", "")),
      date: `${year}${month}${day}`
    };
  }).filter(trade => trade.name && trade.area > 0 && trade.amount > 0 && validTradeDate(trade.date));
}

export function recentMonths(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function summarize(trades) {
  if (!trades.length) return {
    count: 0, min: null, average: null, median: null, max: null,
    minPerPyeong: null, averagePerPyeong: null, medianPerPyeong: null, maxPerPyeong: null
  };
  const amounts = trades.map(trade => trade.amount);
  const perPyeong = trades.map(trade => trade.amount * 3.305785 / trade.area);
  const average = values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    count: trades.length,
    min: Math.min(...amounts),
    average: average(amounts),
    median: median(amounts),
    max: Math.max(...amounts),
    minPerPyeong: Math.round(Math.min(...perPyeong)),
    averagePerPyeong: average(perPyeong),
    medianPerPyeong: Math.round(median(perPyeong)),
    maxPerPyeong: Math.round(Math.max(...perPyeong))
  };
}

async function fetchWithRetry(url) {
  let lastError;
  const maxAttempts = 10;
  const retryDelay = process.env.MOLIT_RETRY_DELAY_MS === undefined ? 5000 : Math.max(0, Number(process.env.MOLIT_RETRY_DELAY_MS));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, retryDelay * Math.min(2 ** (attempt - 1), 6)));
  }
  throw lastError;
}

export async function fetchMonth(endpoint, serviceKey, regionCode, month) {
  const trades = [];
  let receivedItems = 0;
  let expectedTotal = null;
  const seenPageItems = new Set();
  let page = 1;
  while (true) {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("LAWD_CD", regionCode);
    url.searchParams.set("DEAL_YMD", month);
    url.searchParams.set("pageNo", String(page));
    url.searchParams.set("numOfRows", "1000");
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`MOLIT ${regionCode}/${month}: HTTP ${response.status}`);
    const xml = await response.text();
    const resultCode = xmlValue(xml, "resultCode");
    if (resultCode !== "000") throw new Error(`MOLIT ${regionCode}/${month}: ${resultCode || "missing resultCode"} ${xmlValue(xml, "resultMsg")}`);
    const totalValue = xmlValue(xml, "totalCount");
    if (!/^\d+$/.test(totalValue)) throw new Error(`MOLIT ${regionCode}/${month}: missing totalCount`);
    const rawItems = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(match => match[0]);
    const rawItemCount = rawItems.length;
    const pageItems = rawItems.join("");
    if (rawItemCount && seenPageItems.has(pageItems)) throw new Error(`MOLIT ${regionCode}/${month}: repeated pagination page`);
    if (rawItemCount) seenPageItems.add(pageItems);
    const parsedTrades = parseTrades(xml);
    if (parsedTrades.length !== rawItemCount) throw new Error(`MOLIT ${regionCode}/${month}: malformed trade item`);
    trades.push(...parsedTrades.map(trade => ({ ...trade, regionCode })));
    receivedItems += rawItemCount;
    const total = Number(totalValue);
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal) throw new Error(`MOLIT ${regionCode}/${month}: totalCount changed during pagination`);
    if (receivedItems > total) throw new Error(`MOLIT ${regionCode}/${month}: item count exceeds totalCount`);
    if (receivedItems >= total) return trades;
    if (!rawItemCount) throw new Error(`MOLIT ${regionCode}/${month}: pagination ended before totalCount`);
    if (page >= 1000) throw new Error(`MOLIT ${regionCode}/${month}: pagination limit exceeded`);
    page += 1;
  }
}
