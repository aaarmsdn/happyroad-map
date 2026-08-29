import { escapeHtml, formatDate, formatPrice, safeExternalUrl } from "./ui-utils.js?v=10";
import { priceMetric, representativeAreaPrice, transactionPrice, transactionPricePerPyeong } from "./filter-data.js?v=43";
import { areaKeysForSelection } from "./area-data.js?v=1";

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
  if (entry.timeEstimated) parts.push("추정");
  return { departure: clockTime(departure), detail: parts.join(" · ") };
}

function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

const priceMetricLabels = { max: "최고값", average: "평균값", min: "최저값" };

function areaMetrics(record, selectedArea, selectedMetric) {
  if (!selectedArea) return `<p class="empty-note">전용면적을 선택하지 않아 아파트가 숨겨졌습니다.</p>`;
  const metric = priceMetric(selectedMetric);
  const available = areaKeysForSelection(record?.areas, selectedArea);
  const representative = representativeAreaPrice(record, metric, selectedArea);
  const representativeValues = representative
    ? [formatPrice(representative.amount), representative.perPyeong > 0 ? `평당 ${representative.perPyeong.toLocaleString("ko-KR")}만` : ""].filter(Boolean).join(" · ")
    : "";
  const representativeRow = representativeValues
    ? `<div class="price-row price-overall"><b>대표 ${representative.area}㎡</b><span>${representativeValues}</span><small>${representative.count.toLocaleString("ko-KR")}건 · ${selectedArea === "전체" ? "전체" : escapeHtml(selectedArea.replace("-", "~") + "㎡")} 선택 기준</small></div>` : "";
  if (!available.length) return `<p class="empty-note">${selectedArea === "전체" ? "59~120㎡" : escapeHtml(selectedArea.replace("-", "~") + "㎡")} 최근 실거래가가 없습니다.</p>`;
  return `<div class="price-list">${representativeRow}${available.map(area => {
    const data = record.areas[area];
    const amount = transactionPrice(data, metric);
    const perPyeong = transactionPricePerPyeong(data, area, metric);
    const amountLabel = amount ? formatPrice(amount) : `${priceMetricLabels[metric]} 갱신 대기`;
    const perPyeongLabel = perPyeong ? `평당 ${perPyeong.toLocaleString("ko-KR")}만 · ` : "";
    return `<div class="price-row"><b>${escapeHtml(area)}㎡</b><span>${amountLabel}</span><small>${perPyeongLabel}${data.count}건 · <span class="price-endpoint">${formatPrice(data.min)}</span>~<span class="price-endpoint">${formatPrice(data.max)}</span></small></div>`;
  }).join("")}</div>`;
}

function commuteMetric(label, value, includeWalking) {
  if (!value || !Number.isFinite(value.totalMinutes)) return `<div class="metric"><span>${label}</span><b>운행 없음</b></div>`;
  const shuttleMinutes = Number.isFinite(value.shuttleMinutes) ? value.shuttleMinutes : "-";
  const walkingMinutes = Number.isFinite(value.walkingMinutes) ? value.walkingMinutes : "-";
  const breakdown = includeWalking
    ? `셔틀 ${shuttleMinutes} + 도보 ${walkingMinutes}`
    : `셔틀 ${shuttleMinutes} · 도보 제외`;
  return `<div class="metric"><span>${label}</span><b>${value.totalMinutes}분</b><small>${breakdown}</small></div>`;
}

const schoolLevelLabels = { elementary: "초등학교", middle: "중학교", high: "고등학교" };

function schoolSourceHtml(source = {}) {
  const date = source.dataDate ? ` · 기준일 ${escapeHtml(source.dataDate)}` : "";
  return `${escapeHtml(source.name || "학교 위치 공공데이터")}${date} · 직선거리`;
}

function nearbySchoolsHtml(schools = {}, source = {}) {
  const groups = Object.entries(schoolLevelLabels).map(([level, label]) => {
    const rows = (schools[level] || []).slice(0, 3)
      .map(school => `<li><span><b>${escapeHtml(school.name)}</b></span><em>${school.distanceKm.toFixed(1)}km</em></li>`)
      .join("");
    return `<section class="school-group"><h4>${label}</h4>${rows ? `<ol>${rows}</ol>` : `<p>위치 자료 없음</p>`}</section>`;
  }).join("");
  return `<h3 class="detail-subtitle">가까운 학교</h3><p class="source-note">${schoolSourceHtml(source)} · 학교급별 가까운 3곳</p><div class="school-groups">${groups}</div>`;
}

export function schoolDetailHtml(school, source = {}) {
  return `
    <h2>${escapeHtml(school.name)}</h2>
    <p class="detail-meta">${schoolLevelLabels[school.level] || "학교"} · ${escapeHtml(school.ownership || "설립형태 미상")}</p>
    <p class="source-note">${schoolSourceHtml(source)}</p>
    <h3 class="detail-subtitle">주소</h3><p class="detail-meta">${escapeHtml(school.address || "주소 자료 없음")}</p>`;
}

export function apartmentDetailHtml({ complex, relatedLinks, commute, includeWalking = true, record, selectedArea, priceMetric: selectedMetric = "max", schools = {}, schoolSource = {} }) {
  const metric = priceMetric(selectedMetric);
  const roundTrip = Number.isFinite(commute?.roundTripMinutes) ? `${commute.roundTripMinutes}분` : "-";
  const priceSource = record ? `국토교통부 API · 최근 거래일 ${formatDate(record.latestTradeDate)}` : "국토교통부 API 매칭 정보 없음";
  return `
    <h2>${escapeHtml(complex.name).replace("(", "<wbr>(")}</h2>
    <p class="detail-meta">${escapeHtml(complex.type || "아파트")} · ${escapeHtml(complex.households.toLocaleString("ko-KR"))}세대 · ${complex.completed ? `${escapeHtml(complex.completed.slice(0, 4))}년 준공` : "준공일 정보 없음"}</p>
    <div class="metric-grid apartment-metrics">
      ${commuteMetric("출근", commute?.inbound, includeWalking)}
      ${commuteMetric("퇴근", commute?.outbound, includeWalking)}
      <div class="metric"><span>왕복</span><b>${roundTrip}</b><small>${includeWalking ? "도보 포함" : "도보 제외"}</small></div>
    </div>
    <h3 class="detail-subtitle">최근 실거래 · ${priceMetricLabels[metric]}</h3>
    <p class="source-note">${priceSource}</p>
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
        return `<button class="route-item apartment-stop-item" type="button" data-stop-id="${escapeHtml(link.stationId)}"><span><b>${escapeHtml(link.station)}${direction ? ` <em class="direction-badge">${direction}</em>` : ""}</b><small>${escapeHtml(link.routes.slice(0, 2).join(" · ") || "연결 노선")}</small><small class="apartment-stop-times">${times}</small>${inboundDoor}${outboundDoor}${link.fallbackLabel ? `<small class="timing-basis">${escapeHtml(link.fallbackLabel)}</small>` : ""}</span><i data-lucide="chevron-right" aria-hidden="true"></i></button>`;
      }).join("")}
    </div>
    ${nearbySchoolsHtml(schools, schoolSource)}
    <a class="primary-link" href="${escapeHtml(safeExternalUrl(complex.externalUrl))}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>네이버 부동산에서 현재 매물 보기</a>`;
}
