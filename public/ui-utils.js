export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

export function debounce(callback, wait = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

export function formatDate(value) {
  if (!value) return "날짜 없음";
  const match = String(value).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!match) return "날짜 없음";
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return "날짜 없음";
  return `${year}.${month}.${day}`;
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === "https:" && url.hostname === "new.land.naver.com" && url.pathname.startsWith("/complexes/")) return url.href;
  } catch {}
  return "https://new.land.naver.com/";
}

export function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "정보 없음";
  if (amount < 10000) return `${Math.round(amount).toLocaleString("ko-KR")}만원`;
  const eok = Math.floor(amount / 10000);
  const remainder = Math.round(amount % 10000);
  return remainder ? `${eok}억 ${remainder.toLocaleString("ko-KR")}만원` : `${eok}억원`;
}
