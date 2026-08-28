import { bindEvents } from "./app-events.js?v=21";
import { locateUser, populateFilterOptions, resetApp } from "./app-actions.js?v=4";
import { createCommutePlanner } from "./commute-controller.js?v=41";
import { apartmentDetailHtml, schoolDetailHtml, stopDetailHtml } from "./detail-view.js?v=41";
import { apartmentColor, apartmentCommuteTimes, apartmentDoorTimes, apartmentRoundTripMinutes, apartmentStopTimings, directionsByStation, entryMatches, filteredEntries, matchingApartmentLinks, priceFor, pricePerPyeongFor, priceRecordForDisplay, prioritizeCommuteLinks, routeRequestForStop } from "./filter-data.js?v=36";
import { restoreFilters, selectGlobalRoute } from "./filter-logic.js?v=12";
import { addApartmentMarkers, addSchoolMarkers, addStopMarkers, groupStops } from "./map-view.js?v=49";
import { addRoutePaths } from "./route-view.js?v=4";
import { createRequestGate } from "./request-gate.js?v=1";
import { nearestSchools } from "./school-data.js?v=2";
import { searchResults, searchResultsHtml } from "./search-view.js?v=10";
import { escapeHtml, formatDate } from "./ui-utils.js?v=10";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const shuttle = window.HAPPYROAD_MAP_DATA;
const state = {
  category: "전체", route: "전체", routeType: "전체", startHour: "", routeQuery: "",
  area: "전체", priceMetric: "max", apartmentColor: "price", distance: 1.5, households: 200,
  inboundTime: null, outboundTime: null, includeWalking: true,
  showStops: true, showApartments: true, showSchools: false
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
let schoolLayer;
let routeLayer;
let locationLayer;
let commuteLayer;
let visibleLinks = new Map();
let toastTimer;
let storageWarningShown = false;
let detailReturnFocus;
let selectedApartmentDetail;
const apartmentDetailRequests = createRequestGate();
let commutePlanner;
let schoolData = { source: {}, schools: [] };
let schoolDataStatus = "idle";
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
  $$("#categoryChips .chip").forEach(button => {
    const active = button.dataset.category === state.category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("#areaChips .chip").forEach(button => {
    const active = button.dataset.area === state.area;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("#priceMetricControl .segment").forEach(button => {
    const active = button.dataset.priceMetric === state.priceMetric;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("#apartmentColorControl .segment").forEach(button => {
    const active = button.dataset.apartmentColor === state.apartmentColor;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#routeQuery").value = state.routeQuery;
  $("#routeTypeSelect").value = state.routeType;
  $("#startHourSelect").value = state.startHour;
  $("#distanceRange").value = state.distance;
  $("#distanceOutput").value = `${state.distance.toFixed(1)} km`;
  $("#householdMin").value = state.households;
  for (const [key, prefix] of [["inboundTime", "inbound"], ["outboundTime", "outbound"]]) {
    $(`#${prefix}TimeMax`).value = state[key] ?? 180;
    $(`#${prefix}TimeOutput`).value = state[key] ? `${state[key]}분` : "제한 없음";
  }
  $("#includeWalking").checked = state.includeWalking;
  $("#showStops").checked = state.showStops;
  $("#showApartments").checked = state.showApartments;
  $("#showSchools").checked = state.showSchools;
  $("#schoolKey").hidden = !state.showSchools;
  const colorLabels = { price: "아파트 평당가", commute: "아파트 왕복시간", none: "아파트" };
  $("#apartmentColorLabel").textContent = colorLabels[state.apartmentColor];
  $("#apartmentColorScale").hidden = state.apartmentColor === "none";
  $("#apartmentColorScale").setAttribute("aria-label", state.apartmentColor === "commute"
    ? "왕복 120분 미만부터 240분 이상" : "평당 2천5백만원 미만부터 8천만원 이상");
}

function updateRouteOptions() {
  const names = [...new Set(shuttle.entries.filter(entry => entryMatches(entry, state)).map(entry => entry.routeName))].sort((a, b) => a.localeCompare(b, "ko"));
  $("#routeSelect").innerHTML = `<option value="전체">전체 노선 (${names.length})</option>${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (state.route !== "전체" && !names.includes(state.route)) state.route = "전체";
  $("#routeSelect").value = state.route;
}

function clearRoute() {
  routeLayer?.clearLayers();
  $("#map").dataset.routeVisible = "false";
  delete $("#map").dataset.routeKey;
}

function renderMap() {
  updateRouteOptions();
  $("#schoolKey").hidden = !state.showSchools;
  if (state.showSchools && schoolDataStatus === "idle") loadSchoolData();
  const entries = filteredEntries(shuttle.entries, state);
  const stops = groupStops(entries);
  const routeNames = new Set(entries.map(entry => entry.routeName));
  visibleLinks = matchingApartmentLinks(apartments.links, state, directionsByStation(entries), complexById, stations, entries);
  stopLayer.clearLayers();
  apartmentLayer.clearLayers();
  schoolLayer.clearLayers();
  const occupiedPoints = state.showStops ? addStopMarkers({
    L, map, layer: stopLayer, groupedStops: stops,
    onSelect: stop => commutePlanner?.pickMapPoint(stop, stop.name) || openStopDetail(stop)
  }) : [];
  if (state.showApartments) addApartmentMarkers({
    L, map, layer: apartmentLayer, visibleLinks, complexById,
    priceOf: id => priceFor(prices, state, id, complexById.get(id)?.regionCode),
    perPyeongOf: id => pricePerPyeongFor(prices, state, id, complexById.get(id)?.regionCode),
    roundTripOf: (() => {
      const cache = new Map();
      return id => {
        if (!cache.has(id)) cache.set(id, apartmentRoundTripMinutes(linksByComplex.get(id), stations, state.distance, state.includeWalking));
        return cache.get(id);
      };
    })(),
    colorMode: state.apartmentColor,
    colorOf: value => state.apartmentColor === "commute" ? apartmentColor(state, null, value) : apartmentColor(state, value, null),
    onSelect: (complex, link) => commutePlanner?.pickMapPoint(complex, complex.name) || openApartmentDetail(complex, link),
    category: state.category,
    occupiedPoints
  });
  if (state.showSchools && schoolDataStatus === "loaded") addSchoolMarkers({
    L, map, layer: schoolLayer, schools: schoolData.schools,
    onSelect: school => commutePlanner?.pickMapPoint(school, school.name) || openSchoolDetail(school)
  });
  $("#stopCount").textContent = `${stops.size.toLocaleString("ko-KR")}개`;
  $("#apartmentCount").textContent = `${visibleLinks.size.toLocaleString("ko-KR")}개`;
  $("#schoolCount").textContent = schoolCountLabel();
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

function closeDetail(restoreCommute = true) {
  apartmentDetailRequests.cancel();
  const panel = $("#detailPanel");
  panel.classList.remove("open");
  panel.inert = true;
  panel.setAttribute("aria-hidden", "true");
  if (detailReturnFocus?.isConnected) detailReturnFocus.focus();
  detailReturnFocus = null;
  selectedApartmentDetail = null;
  if (restoreCommute) commutePlanner?.restoreMapDetail();
}

function openStopDetail(stop) {
  apartmentDetailRequests.cancel();
  const commutePeek = commutePlanner?.beginMapDetail();
  selectedApartmentDetail = null;
  openDetail(stopDetailHtml(stop));
  if (!commutePeek) {
    const route = routeRequestForStop(stop, shuttle.paths, state);
    if (route) showRoute(route);
  }
}

function selectedApartmentDetailHtml() {
  if (!selectedApartmentDetail) return "";
  const { complex, nearestLink } = selectedApartmentDetail;
  const commute = apartmentCommuteTimes(linksByComplex.get(complex.id), stations, state.distance, state.includeWalking);
  return apartmentDetailHtml({
    complex, nearestLink,
    relatedLinks: prioritizeCommuteLinks(linksByComplex.get(complex.id), commute).map(link => {
      const stop = stations.get(link.stationId);
      const timing = apartmentStopTimings(stop?.entries || []);
      return { ...link, ...timing, ...apartmentDoorTimes(timing, link.distanceKm) };
    }),
    commute,
    includeWalking: state.includeWalking,
    record: priceRecordForDisplay(prices, complex.id, complex.regionCode), selectedArea: state.area, priceMetric: state.priceMetric,
    schools: nearestSchools(schoolData.schools, complex), schoolSource: schoolData.source
  });
}

function renderSelectedApartmentDetail() {
  if (!selectedApartmentDetail || !$("#detailPanel").classList.contains("open")) return;
  $("#detailContent").innerHTML = selectedApartmentDetailHtml();
  lucide.createIcons();
}

async function openApartmentDetail(complex, nearestLink = linksByComplex.get(complex.id)?.[0]) {
  const request = apartmentDetailRequests.begin();
  const commutePeek = commutePlanner?.beginMapDetail();
  if (!commutePeek) clearRoute();
  await loadSchoolData();
  if (!apartmentDetailRequests.isCurrent(request)) return;
  selectedApartmentDetail = { complex, nearestLink };
  openDetail(selectedApartmentDetailHtml());
}

function setPriceMetric(value) {
  state.priceMetric = value;
  syncControls();
  renderMap();
  renderSelectedApartmentDetail();
}

function schoolCountLabel() {
  if (schoolDataStatus === "loading") return "불러오는 중";
  if (schoolDataStatus === "failed") return "사용 불가";
  return schoolDataStatus === "loaded" ? `${schoolData.schools.length.toLocaleString("ko-KR")}개` : "켜면 불러옴";
}

async function loadSchoolData() {
  if (["loaded", "failed"].includes(schoolDataStatus)) return schoolData;
  if (schoolDataStatus === "loading") return schoolData.loading;
  schoolDataStatus = "loading";
  $("#schoolCount").textContent = schoolCountLabel();
  schoolData.loading = fetch("./data/schools.json", { cache: "no-cache" })
    .then(response => response.ok ? response.json() : Promise.reject(new Error("학교 데이터 오류")))
    .then(data => {
      schoolData = data;
      schoolDataStatus = "loaded";
      renderMap();
      return schoolData;
    })
    .catch(error => {
      console.warn("School data unavailable", error);
      schoolData = { source: {}, schools: [] };
      schoolDataStatus = "failed";
      renderMap();
      return schoolData;
    });
  return schoolData.loading;
}

function openSchoolDetail(school) {
  apartmentDetailRequests.cancel();
  const commutePeek = commutePlanner?.beginMapDetail();
  if (!commutePeek) clearRoute();
  selectedApartmentDetail = null;
  openDetail(schoolDetailHtml(school, schoolData.source));
}

function setApartmentColor(value) {
  state.apartmentColor = value;
  syncControls();
  renderMap();
}

function showRoute({ uidKey, routeName }) {
  if (commutePlanner?.isPeeking()) return;
  const paths = shuttle.paths.filter(path => uidKey ? path.uidKey === uidKey : path.routeName === routeName);
  if (!paths.length) return showToast("이 노선의 경로 정보가 없습니다.");
  clearRoute();
  const rendered = addRoutePaths({ L, layer: routeLayer, paths: paths.slice(0, uidKey ? 1 : 4) });
  $("#map").dataset.routeVisible = String(rendered > 0);
  $("#map").dataset.routeKey = `shuttle:${uidKey || routeName}`;
  showToast(`${paths[0].routeName} 경로 표시`);
}

function clearMapSelection(event) {
  if (commutePlanner?.handleMapClick(event)) return;
  clearRoute();
  closeDetail();
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
  $("#loadingText").textContent = "아파트·가격 데이터 불러오는 중";
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
  schoolLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  locationLayer = L.layerGroup().addTo(map);
  commuteLayer = L.layerGroup().addTo(map);
  commutePlanner = createCommutePlanner({ L, map, shuttle, routeLayer, commuteLayer, showToast, clearRoute, closeDetail });
  map.on("moveend", renderMap);
  map.on("click", clearMapSelection);
  populateFilterOptions(shuttle);
  syncControls();
  const locate = () => locateUser({ map, L, layer: locationLayer, showToast });
  const reset = () => resetApp({ state, syncControls, renderMap, map, company: shuttle.company });
  bindEvents({ state, syncControls, renderMap, renderSelectedApartmentDetail, setPriceMetric, setApartmentColor, showRoute, renderSearchResults, selectSearchResult, locate, reset, closeDetail });
  commutePlanner.bind();
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
