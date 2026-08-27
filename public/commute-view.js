import { escapeHtml } from "./ui-utils.js?v=10";

const accessDuration = journey => {
  const distance = ["walk", "car"].includes(journey.accessMode) && Number.isFinite(journey.accessDistanceMeters)
    ? ` (${(journey.accessDistanceMeters / 1000).toFixed(1)}km)` : "";
  return `${journey.accessMinutes}분${distance}`;
};

export function commuteResultsHtml(journeys) {
  if (!journeys.length) return '<p class="commute-status">선택 시각 이후 이용 가능한 셔틀을 찾지 못했습니다.</p>';
  const icons = { car: "car-front", "public-transit": "train-front", walk: "footprints" };
  return journeys.map((journey, index) => `
    <article class="commute-result mode-${escapeHtml(journey.accessMode)}">
      <div class="commute-result-head"><b><span class="commute-mode-label"><i data-lucide="${icons[journey.accessMode]}"></i>${escapeHtml(journey.accessLabel)}</span>${escapeHtml(journey.routeName)}</b><strong class="commute-duration">총 ${journey.totalMinutes}분</strong></div>
      <span>${escapeHtml(journey.station)} · 셔틀 ${escapeHtml(journey.shuttleAt)} · 도착 ${escapeHtml(journey.arrivalAt)}</span>
      <div class="commute-breakdown" aria-label="소요시간 구성">
        <span><small>대기</small><b>${journey.waitMinutes}분</b></span>
        <span><small>셔틀</small><b>${journey.shuttleMinutes}분</b></span>
        <span><small>${escapeHtml(journey.accessLabel)}</small><b>${accessDuration(journey)}</b></span>
      </div>
      <small>${journey.accessEstimated ? "거리 기반 예상" : "카카오 현재 경로"}${journey.accessTransfers ? ` · 환승 ${journey.accessTransfers}회` : ""}${journey.accessFare ? ` · ${journey.accessMode === "car" ? "택시 예상요금" : "대중교통 총요금"} ${journey.accessFare.toLocaleString("ko-KR")}원` : ""}</small>
      <button class="commute-detail-button" type="button" data-commute-detail="${index}"><i data-lucide="list-tree"></i>경로 상세보기</button>
    </article>`).join("");
}

function accessStepHtml(step, index) {
  const labels = { walk: "도보", car: "택시", bus: "버스", subway: "지하철" };
  const detail = [
    Number.isFinite(step.minutes) ? (step.minutes ? `${step.minutes}분` : "1분 미만") : "",
    step.distanceMeters ? `${(step.distanceMeters / 1000).toFixed(1)}km` : "",
    step.stopCount ? `${step.stopCount}개 정류장` : ""
  ].filter(Boolean).join(" · ");
  return `<li><span class="journey-step-index">${index + 1}</span><span><b>${escapeHtml(labels[step.type] || "이동")} · ${escapeHtml(step.guidance || "이동")}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</span></li>`;
}

export function commuteJourneyDetailHtml(journey) {
  const accessSteps = journey.accessRoute?.steps?.length
    ? journey.accessRoute.steps
    : [{ type: journey.accessMode, guidance: `${journey.station}까지 ${journey.accessLabel} 이동`, minutes: journey.accessMinutes }];
  const shuttleStep = {
    type: "shuttle",
    guidance: `${journey.direction === "to-company" ? `${journey.station} 승차 → 회사 하차` : `회사 승차 → ${journey.station} 하차`} · ${journey.routeName}`,
    minutes: journey.shuttleMinutes
  };
  const waitStep = { type: "wait", guidance: `셔틀 ${journey.shuttleAt}까지 대기`, minutes: journey.waitMinutes };
  const steps = journey.direction === "to-company" ? [...accessSteps, waitStep, shuttleStep] : [waitStep, shuttleStep, ...accessSteps];
  const labels = { shuttle: "셔틀", wait: "대기" };
  const departureSummary = journey.direction === "to-company"
    ? `${journey.station} · ${journey.shuttleAt} 출발`
    : `회사 · ${journey.shuttleAt} 출발 · ${journey.station} 하차`;
  const travelSummary = journey.direction === "to-company"
    ? `${journey.accessLabel} + 셔틀`
    : `셔틀 + ${journey.accessLabel}`;
  return `
    <div class="commute-detail-view">
      <div class="commute-detail-summary"><span>${escapeHtml(travelSummary)}</span><strong>총 ${journey.totalMinutes}분</strong><small>${escapeHtml(departureSummary)}</small></div>
      <div class="commute-breakdown detail-breakdown" aria-label="상세 소요시간 구성">
        <span><small>총합</small><b>${journey.totalMinutes}분</b></span>
        <span><small>대기</small><b>${journey.waitMinutes}분</b></span>
        <span><small>셔틀</small><b>${journey.shuttleMinutes}분</b></span>
        <span><small>${escapeHtml(journey.accessLabel)}</small><b>${accessDuration(journey)}</b></span>
      </div>
      <ol class="journey-steps">${steps.map((step, index) => labels[step.type]
        ? `<li><span class="journey-step-index">${index + 1}</span><span><b>${labels[step.type]} · ${escapeHtml(step.guidance)}</b><small>${step.minutes}분</small></span></li>`
        : accessStepHtml(step, index)).join("")}</ol>
    </div>`;
}
