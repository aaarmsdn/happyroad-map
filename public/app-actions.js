import { hourOf, routeTypeOptions } from "./filter-logic.js?v=9";
import { escapeHtml } from "./ui-utils.js?v=10";

const $ = selector => document.querySelector(selector);

export function locateUser({ map, L, layer, showToast }) {
  if (!navigator.geolocation) return showToast("이 기기에서는 위치를 사용할 수 없습니다.");
  navigator.geolocation.getCurrentPosition(position => {
    layer.clearLayers();
    const point = [position.coords.latitude, position.coords.longitude];
    L.circleMarker(point, { radius: 7, color: "white", weight: 3, fillColor: "#2774ae", fillOpacity: 1 }).addTo(layer);
    map.setView(point, 14);
  }, () => showToast("위치 권한을 확인해 주세요."), { enableHighAccuracy: true, timeout: 8000 });
}

export function resetApp({ state, syncControls, renderMap, map, company }) {
  Object.assign(state, {
    category: "전체", route: "전체", routeType: "전체", startHour: "", routeQuery: "",
    area: "전체", priceMetric: "max", distance: 1.5, households: 200, travelTime: null,
    showStops: true, showApartments: true, priceColors: true
  });
  syncControls();
  renderMap();
  map.setView(company, 10);
}

export function populateFilterOptions(shuttle) {
  $("#routeTypeSelect").innerHTML = routeTypeOptions(shuttle.routeTypes).map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  const hours = [...new Set(shuttle.entries.map(entry => hourOf(entry.turnStartTime || entry.time)).filter(Boolean))].sort();
  $("#startHourSelect").innerHTML = `<option value="">전체</option>${hours.map(hour => `<option value="${hour}">${hour}시</option>`).join("")}`;
}
