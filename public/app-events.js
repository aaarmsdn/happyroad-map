import { debounce } from "./ui-utils.js?v=10";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

export function bindEvents({ state, syncControls, renderMap, showRoute, renderSearchResults, selectSearchResult, locate, reset, closeDetail }) {
  const mobilePanel = matchMedia("(max-width: 859px)");
  const controlPanel = $("#controlPanel");
  const detailPanel = $("#detailPanel");
  const searchDialog = $("#searchDialog");
  const syncPanelAccessibility = () => {
    const hidden = mobilePanel.matches && !controlPanel.classList.contains("open");
    controlPanel.inert = hidden;
    controlPanel.setAttribute("aria-hidden", String(hidden));
  };
  new MutationObserver(syncPanelAccessibility).observe(controlPanel, { attributes: true, attributeFilter: ["class"] });
  mobilePanel.addEventListener("change", syncPanelAccessibility);
  syncPanelAccessibility();
  const searchBackground = [$("#map"), $(".app-bar"), $(".map-key"), controlPanel, detailPanel];
  const syncSearchAccessibility = open => {
    searchDialog.toggleAttribute("inert", !open);
    searchDialog.setAttribute("aria-hidden", String(!open));
    searchBackground.forEach(element => element.toggleAttribute("inert", open));
    if (!open) {
      syncPanelAccessibility();
      detailPanel.toggleAttribute("inert", !detailPanel.classList.contains("open"));
    }
  };
  const closeSearch = restoreFocus => {
    searchDialog.classList.remove("open");
    syncSearchAccessibility(false);
    if (restoreFocus) $("#searchButton").focus();
  };
  $$(".segment").forEach(button => button.addEventListener("click", () => {
    $$(".segment").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active);
    });
    $$(".filter-view").forEach(view => view.classList.toggle("active", view.dataset.view === button.dataset.tab));
  }));
  $$("#categoryChips .chip").forEach(button => button.addEventListener("click", () => {
    state.category = button.dataset.category;
    state.route = "전체";
    syncControls();
    renderMap();
  }));
  $$("#areaChips .chip").forEach(button => button.addEventListener("click", () => {
    state.area = button.dataset.area;
    syncControls();
    renderMap();
  }));
  $("#routeQuery").addEventListener("input", debounce(event => {
    state.routeQuery = event.target.value;
    state.route = "전체";
    renderMap();
  }));
  $("#routeSelect").addEventListener("change", event => {
    state.route = event.target.value;
    renderMap();
    if (state.route !== "전체") showRoute({ routeName: state.route });
  });
  $("#routeTypeSelect").addEventListener("change", event => {
    state.routeType = event.target.value;
    state.route = "전체";
    renderMap();
  });
  $("#startHourSelect").addEventListener("change", event => {
    state.startHour = event.target.value;
    state.route = "전체";
    renderMap();
  });
  $("#distanceRange").addEventListener("input", event => {
    state.distance = Number(event.target.value);
    $("#distanceOutput").value = `${state.distance.toFixed(1)} km`;
  });
  $("#distanceRange").addEventListener("change", renderMap);
  $("#householdMin").addEventListener("change", event => {
    state.households = Math.max(0, Number(event.target.value) || 0);
    renderMap();
  });
  $("#travelTimeMax").addEventListener("change", event => {
    state.travelTime = Number(event.target.value) || null;
    renderMap();
  });
  [["#showStops", "showStops"], ["#showApartments", "showApartments"], ["#priceColors", "priceColors"]].forEach(([selector, key]) => $(selector).addEventListener("change", event => {
    state[key] = event.target.checked;
    renderMap();
  }));
  $("#panelButton").addEventListener("click", () => {
    closeDetail();
    $("#controlPanel").classList.add("open");
    syncPanelAccessibility();
    $("#panelCloseButton").focus();
  });
  $("#panelCloseButton").addEventListener("click", () => {
    $("#controlPanel").classList.remove("open");
    syncPanelAccessibility();
    $("#panelButton").focus();
  });
  $("#detailCloseButton").addEventListener("click", closeDetail);
  $("#detailContent").addEventListener("click", event => {
    const button = event.target.closest("[data-route-key], [data-route-name]");
    if (button) showRoute({ uidKey: button.dataset.routeKey, routeName: button.dataset.routeName });
  });
  $("#searchButton").addEventListener("click", () => {
    searchDialog.classList.add("open");
    syncSearchAccessibility(true);
    $("#globalSearch").focus();
    renderSearchResults($("#globalSearch").value);
  });
  $("#searchCloseButton").addEventListener("click", () => closeSearch(true));
  $("#globalSearch").addEventListener("input", debounce(event => renderSearchResults(event.target.value), 100));
  $("#searchResults").addEventListener("click", event => {
    const button = event.target.closest("[data-search-type]");
    if (button) {
      closeSearch(true);
      selectSearchResult(button.dataset.searchType, button.dataset.searchId);
    }
  });
  $("#locateButton").addEventListener("click", locate);
  $("#resetButton").addEventListener("click", reset);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const searchWasOpen = $("#searchDialog").classList.contains("open");
    const detailWasOpen = $("#detailPanel").classList.contains("open");
    const panelWasOpen = $("#controlPanel").classList.contains("open");
    closeSearch(searchWasOpen);
    if (detailWasOpen) closeDetail();
    $("#controlPanel").classList.remove("open");
    syncPanelAccessibility();
    if (!searchWasOpen && panelWasOpen) $("#panelButton").focus();
  });
}
