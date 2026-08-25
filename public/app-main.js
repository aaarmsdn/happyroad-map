import { bindEvents } from "./app-events.js?v=14";
import { apartmentDetailHtml, stopDetailHtml } from "./detail-view.js?v=18";
import { entryMatches, filteredEntries, matchingApartmentLinks, priceColor, priceFor, pricePerPyeongFor, priceRecordForDisplay, routeRequestForStop } from "./filter-data.js?v=21";
import { hourOf, restoreFilters, routeTypeOptions, selectGlobalRoute } from "./filter-logic.js?v=7";
import { addApartmentMarkers, addStopMarkers, decodePolyline, groupStops } from "./map-view.js?v=27";
import { searchResults, searchResultsHtml } from "./search-view.js?v=10";
import { escapeHtml, formatDate } from "./ui-utils.js?v=10";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const shuttle = window.HAPPYROAD_MAP_DATA;
const state = {
  category: "전체", route: "전체", routeType: "전체", startHour: "", routeQuery: "",
  area: "전체", distance: 1.5, households: 200, travelTime: null,
  showStops: true, showApartments: true, priceColors: true
};
function storedFilters() {
  try {
    return JSON.parse(localStorage.getItem("happyroad.filters") || "null");
  } catch {
    return null;
  }
}
restoreFilters(state, storedFilters());

let apartments;
let prices;
let map;
let stopLayer;
let apartmentLayer;
let routeLayer;
let locationLayer;
let visibleLinks = new Map();
let toastTimer;
let storageWarningShown = false;
let detailReturnFocus;
const complexById = new Map();
const linksByComplex = new Map();
const stations = new Map();
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function syncControls() {
  $$("#categoryChips .chip").forEach(button => button.classList.toggle("active", button.dataset.category === state.category));
  $$("#areaChips .chip").forEach(button => button.classList.toggle("active", button.dataset.area === state.area));
  $("#routeQuery").value = state.routeQuery;
  $("#routeTypeSelect").value = state.routeType;
  $("#startHourSelect").value = state.startHour;
  $("#distanceRange").value = state.distance;
  $("#distanceOutput").value = `${state.distance.toFixed(1)} km`;
  $("#householdMin").value = state.households;
  $("#travelTimeMax").value = state.travelTime ?? "";
  $("#showStops").checked = state.showStops;
  $("#showApartments").checked = state.showApartments;
  $("#priceColors").checked = state.priceColors;
}

function updateRouteOptions() {
  const names = [...new Set(shuttle.entries.filter(entry => entryMatches(entry, state)).map(entry => entry.routeName))].sort((a, b) => a.localeCompare(b, "ko"));
  $("#routeSelect").innerHTML = `<option value="전체">전체 노선 (${names.length})</option>${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (state.route !== "전체" && !names.includes(state.route)) state.route = "전체";
  $("#routeSelect").value = state.route;
}

function renderMap(clearRoute = true) {
  if (clearRoute) routeLayer?.clearLayers();
  updateRouteOptions();
  const entries = filteredEntries(shuttle.entries, state);
  const stops = groupStops(entries);
  const routeNames = new Set(entries.map(entry => entry.routeName));
  visibleLinks = matchingApartmentLinks(apartments.links, state, routeNames, complexById);
  stopLayer.clearLayers();
  apartmentLayer.clearLayers();
  const occupiedPoints = state.showStops ? addStopMarkers({ L, map, layer: stopLayer, groupedStops: stops, onSelect: openStopDetail }) : [];
  if (state.showApartments) addApartmentMarkers({
    L, map, layer: apartmentLayer, visibleLinks, complexById,
    priceOf: id => priceFor(prices, state, id, complexById.get(id)?.regionCode),
    perPyeongOf: id => pricePerPyeongFor(prices, state, id, complexById.get(id)?.regionCode),
    colorOf: value => priceColor(state, value),
    onSelect: openApartmentDetail,
    occupiedPoints
  });
  $("#stopCount").textContent = `${stops.size.toLocaleString("ko-KR")}개`;
  $("#apartmentCount").textContent = `${visibleLinks.size.toLocaleString("ko-KR")}개`;
  $("#resultSummary").textContent = `노선 ${routeNames.size.toLocaleString("ko-KR")} · 아파트 ${visibleLinks.size.toLocaleString("ko-KR")}`;
  try {
    localStorage.setItem("happyroad.filters", JSON.stringify(state));
  } catch {
    if (!storageWarningShown) showToast("필터 설정을 저장하지 못했습니다.");
    storageWarningShown = true;
  }
  lucide.createIcons();
}

function openDetail(html) {
  detailReturnFocus = document.activeElement;
  $("#detailContent").innerHTML = html;
  const panel = $("#detailPanel");
  panel.classList.add("open");
  panel.inert = false;
  panel.setAttribute("aria-hidden", "false");
  panel.scrollTop = 0;
  $("#controlPanel").classList.remove("open");
  lucide.createIcons();
  $("#detailCloseButton").focus({ preventScroll: true });
}

function closeDetail() {
  const panel = $("#detailPanel");
  panel.classList.remove("open");
  panel.inert = true;
  panel.setAttribute("aria-hidden", "true");
  if (detailReturnFocus?.isConnected) detailReturnFocus.focus();
  detailReturnFocus = null;
}

function openStopDetail(stop) {
  openDetail(stopDetailHtml(stop));
  const route = routeRequestForStop(stop, shuttle.paths, state);
  if (route) showRoute(route);
}

function openApartmentDetail(complex, nearestLink = linksByComplex.get(complex.id)?.[0]) {
  openDetail(apartmentDetailHtml({
    complex, nearestLink,
    relatedLinks: (linksByComplex.get(complex.id) || []).slice().sort((a, b) => a.distanceKm - b.distanceKm),
    record: priceRecordForDisplay(prices, complex.id, complex.regionCode), selectedArea: state.area
  }));
}

function showRoute({ uidKey, routeName }) {
  const paths = shuttle.paths.filter(path => uidKey ? path.uidKey === uidKey : path.routeName === routeName);
  if (!paths.length) return showToast("이 노선의 경로 정보가 없습니다.");
  routeLayer.clearLayers();
  const bounds = [];
  for (const path of paths.slice(0, uidKey ? 1 : 4)) {
    const points = decodePolyline(path.encoded);
    if (!points.length) continue;
    L.polyline(points, { color: "#f04438", weight: 5, opacity: 0.86 }).addTo(routeLayer);
    bounds.push(...points);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  showToast(`${paths[0].routeName} 경로 표시`);
}

function renderSearchResults(query) {
  $("#searchResults").innerHTML = searchResultsHtml(query, searchResults(query, stations, shuttle.routes, apartments.complexes));
  lucide.createIcons();
}

function selectSearchResult(type, id) {
  if (type === "route") {
    selectGlobalRoute(state, id);
    syncControls();
    renderMap();
    showRoute({ routeName: id });
    return;
  }
  if (type === "stop") {
    const stop = stations.get(id);
    map.setView([stop.lat, stop.lng], 15);
    openStopDetail(stop);
    return;
  }
  const complex = complexById.get(id);
  map.setView([complex.lat, complex.lng], 15);
  openApartmentDetail(complex);
}

function locate() {
  if (!navigator.geolocation) return showToast("이 기기에서는 위치를 사용할 수 없습니다.");
  navigator.geolocation.getCurrentPosition(position => {
    locationLayer.clearLayers();
    const point = [position.coords.latitude, position.coords.longitude];
    L.circleMarker(point, { radius: 7, color: "white", weight: 3, fillColor: "#2774ae", fillOpacity: 1 }).addTo(locationLayer);
    map.setView(point, 14);
  }, () => showToast("위치 권한을 확인해 주세요."), { enableHighAccuracy: true, timeout: 8000 });
}

function reset() {
  Object.assign(state, {
    category: "전체", route: "전체", routeType: "전체", startHour: "", routeQuery: "",
    area: "전체", distance: 1.5, households: 200, travelTime: null,
    showStops: true, showApartments: true, priceColors: true
  });
  syncControls();
  renderMap();
  map.setView(shuttle.company, 10);
}

function populateFilters() {
  $("#routeTypeSelect").innerHTML = routeTypeOptions(shuttle.routeTypes).map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  const hours = [...new Set(shuttle.entries.map(entry => hourOf(entry.turnStartTime || entry.time)).filter(Boolean))].sort();
  $("#startHourSelect").innerHTML = `<option value="">전체</option>${hours.map(hour => `<option value="${hour}">${hour}시</option>`).join("")}`;
}

async function initialize() {
  if (!shuttle || !window.L) throw new Error("지도 라이브러리 또는 셔틀 데이터를 불러오지 못했습니다.");
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }
  $("#loadingText").textContent = "아파트와 가격 데이터 불러오는 중";
  [apartments, prices] = await Promise.all([
    fetch("./data/apartments.json").then(response => response.ok ? response.json() : Promise.reject(new Error("아파트 데이터 오류"))),
    fetch("./data/prices.json", { cache: "no-cache" }).then(response => response.ok ? response.json() : Promise.reject(new Error("가격 데이터 오류")))
  ]);
  apartments.complexes.forEach(complex => complexById.set(complex.id, complex));
  apartments.links.forEach(link => {
    if (!linksByComplex.has(link.complexId)) linksByComplex.set(link.complexId, []);
    linksByComplex.get(link.complexId).push(link);
  });
  linksByComplex.forEach(links => links.sort((a, b) => a.distanceKm - b.distanceKm));
  groupStops(shuttle.entries).forEach((stop, key) => stations.set(key, stop));
  map = L.map("map", { zoomControl: false, preferCanvas: true, minZoom: 6 }).setView(shuttle.company, 10);
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  stopLayer = L.layerGroup().addTo(map);
  apartmentLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  locationLayer = L.layerGroup().addTo(map);
  map.on("moveend", () => renderMap(false));
  populateFilters();
  syncControls();
  bindEvents({ state, syncControls, renderMap, showRoute, renderSearchResults, selectSearchResult, locate, reset, closeDetail });
  renderMap();
  $("#dataFreshness").textContent = `가격 ${prices.generatedAt ? formatDate(prices.generatedAt) : "갱신 대기"} · 셔틀 ${formatDate(shuttle.generatedAt)}`;
  lucide.createIcons();
  $("#loadingScreen").classList.add("done");
  setTimeout(() => $("#loadingScreen").remove(), 350);
}

initialize().catch(error => {
  console.error(error);
  $("#loadingText").textContent = error.message;
  $("#loadingScreen strong").textContent = "앱을 열 수 없습니다";
});
