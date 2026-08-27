import { accessRoutesFor, isKoreaPoint, nearestShuttleStops, nextFiveMinuteValue, recommendCommuteJourneys } from "./commute-routing.js?v=34";
import { commuteJourneyDetailHtml, commuteResultsHtml } from "./commute-view.js?v=8";
import { addJourneyPaths, routeSegmentPoints } from "./route-view.js?v=4";
import { escapeHtml } from "./ui-utils.js?v=10";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

export function createCommutePlanner({ L, map, shuttle, routeLayer, commuteLayer, showToast, clearRoute, closeDetail }) {
  const apiBase = document.querySelector('meta[name="commute-api-base"]')?.content.replace(/\/$/, "") || "";
  let point;
  let pickingPoint = false;
  let routeController;
  let placeController;
  let searchVersion = 0;
  let pointVersion = 0;
  let journeys = [];
  let stage = "search";
  let peekingDetail = false;

  function setStage(nextStage) {
    stage = nextStage;
    const panel = $("#commutePanel");
    const search = nextStage === "search";
    panel.dataset.stage = nextStage;
    panel.classList.remove("detail-expanded");
    $("#commuteSearchView").hidden = !search;
    $("#commuteResults").hidden = search;
    $("#commuteStageBack").hidden = search;
    $("#commuteStageBack").setAttribute("aria-label", nextStage === "detail" ? "추천 경로로 돌아가기" : "검색 조건으로 돌아가기");
    $("#commuteStageTitle").textContent = search ? "출퇴근 길찾기" : nextStage === "detail" ? "경로 상세" : "추천 경로";
    $("#commuteStageSubtitle").hidden = !search;
    panel.scrollTop = 0;
    if (panel.classList.contains("open")) $(search ? "#commutePlaceQuery" : "#commuteStageBack").focus();
  }

  function collapseDetail() {
    if (stage === "detail") $("#commutePanel").classList.remove("detail-expanded");
  }

  function setPanelOpen(open) {
    const panel = $("#commutePanel");
    panel.classList.toggle("open", open);
    panel.inert = !open;
    panel.setAttribute("aria-hidden", String(!open));
    [".app-bar", ".map-key"].forEach(selector => { $(selector).inert = open; });
    const controls = $("#controlPanel");
    const hiddenMobile = matchMedia("(max-width: 859px)").matches && !controls.classList.contains("open");
    controls.inert = open || hiddenMobile;
    controls.setAttribute("aria-hidden", String(open || hiddenMobile));
  }

  function setPanel(open) {
    const panel = $("#commutePanel");
    setPanelOpen(open);
    if (open) {
      $("#controlPanel").classList.remove("open");
      closeDetail(false);
      panel.scrollTop = 0;
      $("#commuteCloseButton").focus();
    } else $("#commuteButton").focus();
  }

  function open() {
    if (!$("#commuteDepartureAt").value) $("#commuteDepartureAt").value = nextFiveMinuteValue();
    setStage("search");
    setPanel(true);
  }

  function close() {
    routeController?.abort();
    searchVersion += 1;
    const locationButton = $("#commuteUseCurrentLocation");
    if (locationButton.hasAttribute("aria-busy")) {
      pointVersion += 1;
      locationButton.disabled = false;
      locationButton.removeAttribute("aria-busy");
    }
    placeController?.abort();
    setPanel(false);
  }

  function clearResults() {
    routeController?.abort();
    searchVersion += 1;
    journeys = [];
    $("#commuteResults").replaceChildren();
    clearRoute();
  }

  function selectPoint(latlng, name = "선택 위치", requestVersion = null) {
    if (requestVersion !== null && requestVersion !== pointVersion) return false;
    const selected = { lat: Number(latlng.lat ?? latlng[0]), lng: Number(latlng.lng ?? latlng[1]) };
    if (!isKoreaPoint(selected)) {
      showToast("대한민국 내 위치만 길찾기할 수 있습니다.");
      return false;
    }
    const locationButton = $("#commuteUseCurrentLocation");
    locationButton.disabled = false;
    locationButton.removeAttribute("aria-busy");
    pointVersion += 1;
    placeController?.abort();
    clearResults();
    point = selected;
    commuteLayer.clearLayers();
    L.circleMarker([point.lat, point.lng], {
      radius: 12, color: "#ffffff", weight: 4, fillColor: "#f04438", fillOpacity: 1, bubblingMouseEvents: false
    }).addTo(commuteLayer).bindTooltip(escapeHtml(name));
    $("#commutePointLabel").textContent = name;
    $("#commutePointLabel").classList.add("selected");
    $("#commutePlaceQuery").value = name;
    return true;
  }

  async function reverseGeocode(selected, version) {
    if (!apiBase) return;
    try {
      const response = await fetch(`${apiBase}/address?lat=${encodeURIComponent(selected.lat)}&lng=${encodeURIComponent(selected.lng)}`, { cache: "no-store" });
      if (!response.ok) return;
      const { address } = await response.json();
      if (version !== pointVersion || !address) return;
      $("#commutePointLabel").textContent = address;
      $("#commutePlaceQuery").value = address;
    } catch {}
  }

  function pickMapPoint(latlng, name = "") {
    if (!pickingPoint) return false;
    pickingPoint = false;
    const selected = { lat: Number(latlng.lat ?? latlng[0]), lng: Number(latlng.lng ?? latlng[1]) };
    const label = name || `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`;
    if (!selectPoint(selected, label)) return true;
    const version = pointVersion;
    if (!name) void reverseGeocode(selected, version);
    open();
    return true;
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return showToast("이 기기에서는 위치를 사용할 수 없습니다.");
    const button = $("#commuteUseCurrentLocation");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const requestVersion = ++pointVersion;
    navigator.geolocation.getCurrentPosition(position => {
      if (requestVersion !== pointVersion) return;
      const selected = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (selectPoint(selected, "현재 위치", requestVersion)) map.setView([selected.lat, selected.lng], 15);
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }, () => {
      if (requestVersion !== pointVersion) return;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      showToast("위치 권한을 확인해 주세요.");
    }, { enableHighAccuracy: true, timeout: 8000 });
  }

  async function searchPlaces(query) {
    const results = $("#commutePlaceResults");
    placeController?.abort();
    if (!query.trim()) return results.replaceChildren();
    if (!apiBase) return void (results.innerHTML = '<p class="commute-status">장소 검색 API 연결 전입니다. 지도에서 위치를 선택해 주세요.</p>');
    results.innerHTML = '<p class="commute-status">장소 검색 중</p>';
    placeController = new AbortController();
    try {
      const response = await fetch(`${apiBase}/places?q=${encodeURIComponent(query.trim())}`, { signal: placeController.signal });
      if (!response.ok) throw new Error("장소 검색 실패");
      const places = await response.json();
      results.innerHTML = places.length ? places.slice(0, 12).map((place, index) => `
        <button class="commute-place-result" type="button" data-commute-place="${index}">
          <b>${escapeHtml(place.name)}</b><small>${escapeHtml(place.address || "주소 없음")}</small>
        </button>`).join("") : '<p class="commute-status">검색 결과가 없습니다.</p>';
      results._places = places;
    } catch (error) {
      if (error.name !== "AbortError") results.innerHTML = '<p class="commute-status">장소 검색을 불러오지 못했습니다.</p>';
    }
  }

  function renderResults(nextJourneys, autoShow = false) {
    journeys = nextJourneys;
    commuteLayer.clearLayers();
    $("#commuteResults").innerHTML = commuteResultsHtml(journeys);
    setStage("results");
    lucide.createIcons();
    if (autoShow && journeys[0]) {
      showJourneyRoute(journeys[0]);
      map.setView([point.lat, point.lng], 14);
    }
  }

  function journeyRouteData(journey) {
    const path = shuttle.paths.find(item => item.uidKey === journey.uidKey);
    if (!path) return null;
    const inbound = journey.direction === "to-company";
    return {
      path,
      start: inbound ? journey.stop : journey.company,
      end: inbound ? journey.company : journey.stop,
      routeStops: shuttle.entries.filter(entry => entry.uidKey === journey.uidKey)
    };
  }

  function hasJourneyRoute(journey) {
    const route = journeyRouteData(journey);
    return Boolean(route && routeSegmentPoints(route.path.encoded, route.start, route.end, route.routeStops).length > 1);
  }

  function showJourneyRoute(journey) {
    const route = journeyRouteData(journey);
    if (!route) return showToast("이 셔틀의 경로 정보가 없습니다.");
    const { path, start, end, routeStops } = route;
    clearRoute();
    const rendered = addJourneyPaths({
      L, layer: routeLayer, path, start, end,
      routeStops,
      accessMode: journey.accessMode,
      accessPoints: journey.accessRoute?.points?.length > 1 ? journey.accessRoute.points : [],
      accessConnectors: journey.accessRoute?.connectors
    });
    $("#map").dataset.routeVisible = String(rendered > 0);
    $("#map").dataset.routeKey = `commute:${journey.uidKey}`;
  }

  function renderDetail(journey) {
    showJourneyRoute(journey);
    $("#commuteResults").innerHTML = commuteJourneyDetailHtml(journey);
    setStage("detail");
    lucide.createIcons();
  }

  async function calculate() {
    if (!point) return showToast("지도 또는 검색에서 위치를 선택해 주세요.");
    const departureAt = new Date($("#commuteDepartureAt").value);
    if (!Number.isFinite(departureAt.getTime())) return showToast("출발 일시를 확인해 주세요.");
    const mode = $("#commuteMode").dataset.value || "to-company";
    setStage("results");
    $("#commuteResults").innerHTML = '<p class="commute-status">셔틀과 이동 경로 계산 중</p>';
    routeController?.abort();
    routeController = new AbortController();
    const version = ++searchVersion;
    const stops = nearestShuttleStops(shuttle.entries, mode, point, 12, departureAt);
    try {
      const routes = await accessRoutesFor({ stops, direction: mode, point, apiBase, signal: routeController.signal });
      if (version === searchVersion) renderResults(recommendCommuteJourneys({
        entries: shuttle.entries, mode, point, departureAt, accessMinutesByMode: routes, acceptJourney: hasJourneyRoute
      }), true);
    } catch (error) {
      if (version !== searchVersion) return;
      const message = error.message === "route_rate_limited"
        ? "요청이 많습니다. 잠시 후 다시 시도해 주세요."
        : "길찾기 서버에 연결하지 못했습니다. 다시 시도해 주세요.";
      $("#commuteResults").innerHTML = `<p class="commute-status">${message}</p>`;
    }
  }

  function bind() {
    $("#commuteButton").addEventListener("click", open);
    $("#commuteCloseButton").addEventListener("click", close);
    $("#commuteStageBack").addEventListener("click", () => {
      if (stage === "detail") return renderResults(journeys);
      clearResults();
      setStage("search");
    });
    $$("#commuteMode [data-commute-mode]").forEach(button => button.addEventListener("click", () => {
      clearResults();
      $$("#commuteMode [data-commute-mode]").forEach(item => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
      $("#commuteMode").dataset.value = button.dataset.commuteMode;
    }));
    $("#commuteDepartureAt").addEventListener("input", clearResults);
    $("#commuteUseCurrentLocation").addEventListener("click", useCurrentLocation);
    $("#commutePickOnMap").addEventListener("click", () => { pickingPoint = true; close(); showToast("지도에서 출발 또는 도착 위치를 선택하세요."); });
    $("#commutePlaceForm").addEventListener("submit", event => { event.preventDefault(); searchPlaces($("#commutePlaceQuery").value); });
    $("#commutePlaceResults").addEventListener("click", event => {
      const button = event.target.closest("[data-commute-place]");
      const place = button ? $("#commutePlaceResults")._places?.[Number(button.dataset.commutePlace)] : null;
      if (place && selectPoint(place, place.name)) {
        $("#commutePlaceResults").replaceChildren();
        map.setView([place.lat, place.lng], 15);
      }
    });
    $("#commuteSearchButton").addEventListener("click", calculate);
    $("#commuteResults").addEventListener("click", event => {
      const button = event.target.closest("[data-commute-detail]");
      const journey = journeys[Number(button?.dataset.commuteDetail)];
      if (journey) renderDetail(journey);
    });
    $("#commutePanel").addEventListener("pointerdown", event => {
      if (stage === "detail" && !event.target.closest("button, input, select, a")) $("#commutePanel").classList.add("detail-expanded");
    });
    $("#map").addEventListener("pointerdown", collapseDetail, { passive: true });
    $("#map").addEventListener("wheel", collapseDetail, { passive: true });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && $("#commutePanel").classList.contains("open")) close(); });
  }

  return {
    bind,
    beginMapDetail() {
      if (peekingDetail) return true;
      if (!$("#commutePanel").classList.contains("open")) return false;
      peekingDetail = true;
      setPanelOpen(false);
      return true;
    },
    restoreMapDetail() {
      if (!peekingDetail) return false;
      peekingDetail = false;
      setPanelOpen(true);
      $(stage === "search" ? "#commutePlaceQuery" : "#commuteStageBack").focus({ preventScroll: true });
      return true;
    },
    isPeeking() { return peekingDetail; },
    pickMapPoint,
    handleMapClick(event) {
      if (pickingPoint && event?.latlng) {
        return pickMapPoint(event.latlng);
      }
      if (peekingDetail) {
        closeDetail();
        return true;
      }
      if ($("#commutePanel").classList.contains("open")) {
        collapseDetail();
        return true;
      }
      return false;
    }
  };
}
