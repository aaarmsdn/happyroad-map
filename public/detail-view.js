import { escapeHtml, formatDate, formatPrice, safeExternalUrl } from "./ui-utils.js?v=9";

export function stopDetailHtml(stop) {
  const variants = [...new Map(stop.entries.map(entry => [entry.uidKey, entry])).values()]
    .sort((a, b) => timeMinutes(a.time || a.turnStartTime) - timeMinutes(b.time || b.turnStartTime) || a.routeName.localeCompare(b.routeName, "ko"));
  return `
    <h2>${escapeHtml(stop.name)}</h2>
    <p class="detail-meta">운행 ${variants.length.toLocaleString("ko-KR")}건 · ${new Set(variants.map(item => item.routeName)).size}개 노선</p>
    <div class="metric-grid">
      <div class="metric"><span>출근</span><b>${variants.filter(item => item.routeCategory === "출근").length}건</b></div>
      <div class="metric"><span>퇴근</span><b>${variants.filter(item => item.routeCategory === "퇴근").length}건</b></div>
      <div class="metric"><span>위치</span><b>${stop.lat.toFixed(3)}, ${stop.lng.toFixed(3)}</b></div>
    </div>
    <div class="route-list">
      ${variants.slice(0, 40).map(entry => `
        <button class="route-item" type="button" data-route-key="${escapeHtml(entry.uidKey)}">
          <span><b>${escapeHtml(entry.routeName)}</b><small>${escapeHtml(entry.turnName)} · ${escapeHtml(entry.routeType)}</small></span>
          <span class="route-time">${escapeHtml(entry.time || entry.turnStartTime || "-")}</span>
        </button>`).join("")}
    </div>
    ${variants.length > 40 ? `<p class="detail-meta">앞 40건만 표시</p>` : ""}`;
}

function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function areaMetrics(record, selectedArea) {
  const ordered = selectedArea === "전체" ? ["59", "84", "102", "115"] : [selectedArea];
  const available = ordered.filter(area => Number(record?.areas?.[area]?.count) > 0);
  if (!available.length) return `<p class="empty-note">선택 면적의 최근 실거래가가 없습니다.</p>`;
  return `<div class="price-list">${available.map(area => {
    const data = record.areas[area];
    return `<div class="price-row"><b>${area}㎡</b><span>${formatPrice(data.median)}</span><small>${data.count}건 · ${formatPrice(data.min)}~${formatPrice(data.max)}</small></div>`;
  }).join("")}</div>`;
}

export function apartmentDetailHtml({ complex, nearestLink, relatedLinks, record, selectedArea }) {
  return `
    <h2>${escapeHtml(complex.name).replace("(", "<wbr>(")}</h2>
    <p class="detail-meta">${escapeHtml(complex.type || "아파트")} · ${escapeHtml(complex.households.toLocaleString("ko-KR"))}세대 · ${complex.completed ? `${escapeHtml(complex.completed.slice(0, 4))}년 준공` : "준공일 정보 없음"}</p>
    <div class="metric-grid apartment-metrics">
      <div class="metric"><span>가까운 정류장</span><b>${escapeHtml(nearestLink?.station || "정보 없음")}</b></div>
      <div class="metric"><span>거리</span><b>${nearestLink ? `${nearestLink.distanceKm.toFixed(1)} km` : "-"}</b></div>
      <div class="metric"><span>통근</span><b>${nearestLink?.travelMinutes ? `${escapeHtml(nearestLink.travelMinutes)}분` : "-"}</b></div>
    </div>
    <h3 class="detail-subtitle">최근 실거래</h3>
    <p class="source-note">국토교통부 · 최근 거래일 ${formatDate(record?.latestTradeDate)}</p>
    ${areaMetrics(record, selectedArea)}
    <div class="route-list">
      ${relatedLinks.slice(0, 5).map(link => `<button class="route-item" type="button" data-route-name="${escapeHtml(link.routes[0] || "")}"><span><b>${escapeHtml(link.station)}</b><small>${escapeHtml(link.routes.slice(0, 2).join(" · ") || "연결 노선")}</small></span><span class="route-time">${link.travelMinutes ? `${escapeHtml(link.travelMinutes)}분` : `${link.distanceKm.toFixed(1)}km`}</span></button>`).join("")}
    </div>
    <a class="primary-link" href="${escapeHtml(safeExternalUrl(complex.externalUrl))}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>네이버 부동산에서 현재 매물 보기</a>`;
}
