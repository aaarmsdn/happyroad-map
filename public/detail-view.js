import { escapeHtml, formatDate, formatPrice, safeExternalUrl } from "./ui-utils.js?v=10";
import { priceMetric, transactionPrice, transactionPricePerPyeong } from "./filter-data.js?v=33";

export function stopDetailHtml(stop) {
  const variants = [...new Map(stop.entries.map(entry => [entry.uidKey, entry])).values()]
    .sort((a, b) => timeMinutes(a.time || a.turnStartTime) - timeMinutes(b.time || b.turnStartTime) || a.routeName.localeCompare(b.routeName, "ko"));
  return `
    <h2>${escapeHtml(stop.name)}</h2>
    <p class="detail-meta">운행 ${variants.length.toLocaleString("ko-KR")}건 · ${new Set(variants.map(item => item.routeName)).size}개 노선</p>
    <div class="metric-grid">
      <div class="metric"><span>출근</span><b>${variants.filter(item => (item.direction || item.routeCategory) === "출근").length}건</b></div>
      <div class="metric"><span>퇴근</span><b>${variants.filter(item => (item.direction || item.routeCategory) === "퇴근").length}건</b></div>
      <div class="metric"><span>위치</span><b>${stop.lat.toFixed(3)}, ${stop.lng.toFixed(3)}</b></div>
    </div>
    <div class="route-list">
      ${variants.slice(0, 40).map(entry => {
        const timing = stopTiming(entry);
        return `
        <button class="route-item" type="button" data-route-key="${escapeHtml(entry.uidKey)}">
          <span><b>${escapeHtml(entry.routeName)}</b><small>${escapeHtml(entry.turnName)} · ${escapeHtml(entry.routeType)}</small></span>
          <span class="route-timing"><b class="route-time">${escapeHtml(timing.departure)}</b>${timing.detail ? `<small>${escapeHtml(timing.detail)}</small>` : ""}</span>
        </button>`;
      }).join("")}
    </div>
    ${variants.length > 40 ? `<p class="detail-meta">앞 40건만 표시</p>` : ""}`;
}

function clockTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "-";
}

function stopTiming(entry) {
  const inbound = (entry.direction || entry.routeCategory) === "출근";
  const outbound = (entry.direction || entry.routeCategory) === "퇴근";
  if (!inbound && !outbound) return { departure: clockTime(entry.time || entry.turnStartTime), detail: "" };
  const departure = inbound
    ? entry.time
    : entry.companyTime || entry.scheduledCompanyDepartureTime || entry.turnStartTime;
  const arrival = inbound
    ? entry.companyTime || entry.scheduledCompanyArrivalTime || entry.turnFinalArrivalTime
    : entry.time;
  const rawMinutes = inbound ? entry.minutesToCompany : entry.minutesFromCompany;
  const minutes = rawMinutes === null || rawMinutes === "" || rawMinutes === undefined ? null : Number(rawMinutes);
  const parts = [];
  if (Number.isFinite(minutes) && minutes >= 0) parts.push(`${Math.round(minutes)}분`);
  if (clockTime(arrival) !== "-") parts.push(`${inbound ? "회사" : "정류장"} ${clockTime(arrival)} 도착`);
  return { departure: clockTime(departure), detail: parts.join(" · ") };
}

function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

const priceMetricLabels = { max: "최고값", average: "평균값", min: "최저값" };

function areaMetrics(record, selectedArea, selectedMetric) {
  const metric = priceMetric(selectedMetric);
  const ordered = selectedArea === "전체"
    ? Object.keys(record?.areas || {}).sort((a, b) => Number(a) - Number(b))
    : [selectedArea];
  const available = ordered.filter(area => Number(record?.areas?.[area]?.count) > 0);
  const overallAmount = transactionPrice(record, metric);
  const overallPerPyeong = Number(record?.[`${metric}PerPyeong`]);
  if (!available.length && selectedArea === "전체" && (overallAmount || overallPerPyeong > 0)) {
    const values = [overallAmount ? formatPrice(overallAmount) : "", overallPerPyeong > 0 ? `평당 ${overallPerPyeong.toLocaleString("ko-KR")}만` : ""].filter(Boolean).join(" · ");
    return `<div class="price-list"><div class="price-row"><b>전체 면적</b><span>${values}</span><small>${Number(record.matchedTradeCount).toLocaleString("ko-KR")}건 · 대상 면적 외 거래 포함</small></div></div>`;
  }
  if (!available.length && selectedArea === "전체" && Number(record?.matchedTradeCount) > 0) {
    return `<p class="empty-note">${priceMetricLabels[metric]} 갱신 대기 · 최근 거래 ${Number(record.matchedTradeCount).toLocaleString("ko-KR")}건</p>`;
  }
  if (!available.length) return `<p class="empty-note">선택 면적의 최근 실거래가가 없습니다.</p>`;
  return `<div class="price-list">${available.map(area => {
    const data = record.areas[area];
    const amount = transactionPrice(data, metric);
    const perPyeong = transactionPricePerPyeong(data, area, metric);
    const amountLabel = amount ? formatPrice(amount) : `${priceMetricLabels[metric]} 갱신 대기`;
    const perPyeongLabel = perPyeong ? `평당 ${perPyeong.toLocaleString("ko-KR")}만 · ` : "";
    return `<div class="price-row"><b>${escapeHtml(area)}㎡</b><span>${amountLabel}</span><small>${perPyeongLabel}${data.count}건 · ${formatPrice(data.min)}~${formatPrice(data.max)}</small></div>`;
  }).join("")}</div>`;
}

export function apartmentDetailHtml({ complex, nearestLink, relatedLinks, record, selectedArea, priceMetric: selectedMetric = "max" }) {
  const metric = priceMetric(selectedMetric);
  return `
    <h2>${escapeHtml(complex.name).replace("(", "<wbr>(")}</h2>
    <p class="detail-meta">${escapeHtml(complex.type || "아파트")} · ${escapeHtml(complex.households.toLocaleString("ko-KR"))}세대 · ${complex.completed ? `${escapeHtml(complex.completed.slice(0, 4))}년 준공` : "준공일 정보 없음"}</p>
    <div class="metric-grid apartment-metrics">
      <div class="metric"><span>가까운 정류장</span><b>${escapeHtml(nearestLink?.station || "정보 없음")}</b></div>
      <div class="metric"><span>거리</span><b>${nearestLink ? `${nearestLink.distanceKm.toFixed(1)} km` : "-"}</b></div>
      <div class="metric"><span>통근</span><b>${nearestLink?.travelMinutes ? `${escapeHtml(nearestLink.travelMinutes)}분` : "-"}</b></div>
    </div>
    <h3 class="detail-subtitle">최근 실거래 · ${priceMetricLabels[metric]}</h3>
    <p class="source-note">${record?.matchStatus === "snapshot" ? "국토교통부 공개자료 스냅샷" : "국토교통부 API"} · 최근 거래일 ${formatDate(record?.latestTradeDate)}</p>
    ${areaMetrics(record, selectedArea, metric)}
    <div class="route-list">
      ${relatedLinks.slice(0, 5).map(link => {
        const inbound = Number.isFinite(link.inboundMinutes);
        const outbound = Number.isFinite(link.outboundMinutes);
        const direction = inbound && outbound ? "출퇴근" : inbound ? "출근" : outbound ? "퇴근" : "";
        const times = [inbound ? `출근 ${link.inboundMinutes}분` : "", outbound ? `퇴근 ${link.outboundMinutes}분` : "", `도보 ${link.distanceKm.toFixed(1)}km`].filter(Boolean).join(" · ");
        const inboundDoor = link.leaveHomeAt && link.inboundStopAt && link.inboundCompanyAt
          ? `<small class="apartment-door-time">집 ${escapeHtml(link.leaveHomeAt)} 출발 · 셔틀 ${escapeHtml(link.inboundStopAt)} · 회사 ${escapeHtml(link.inboundCompanyAt)}</small>` : "";
        const outboundDoor = link.outboundCompanyAt && link.outboundStopAt && link.arriveHomeAt
          ? `<small class="apartment-door-time">회사 ${escapeHtml(link.outboundCompanyAt)} · 정류장 ${escapeHtml(link.outboundStopAt)} · 집 ${escapeHtml(link.arriveHomeAt)} 도착</small>` : "";
        return `<button class="route-item apartment-stop-item" type="button" data-route-name="${escapeHtml(link.routes[0] || "")}"><span><b>${escapeHtml(link.station)}${direction ? ` <em class="direction-badge">${direction}</em>` : ""}</b><small>${escapeHtml(link.routes.slice(0, 2).join(" · ") || "연결 노선")}</small><small class="apartment-stop-times">${times}</small>${inboundDoor}${outboundDoor}${link.fallbackLabel ? `<small class="timing-basis">${escapeHtml(link.fallbackLabel)}</small>` : ""}</span><i data-lucide="chevron-right" aria-hidden="true"></i></button>`;
      }).join("")}
    </div>
    <a class="primary-link" href="${escapeHtml(safeExternalUrl(complex.externalUrl))}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>네이버 부동산에서 현재 매물 보기</a>`;
}
