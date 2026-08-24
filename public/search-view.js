import { escapeHtml, normalize } from "./ui-utils.js?v=9";

export function searchResults(query, stations, routes, complexes) {
  const normalized = normalize(query);
  if (!normalized) return [];
  const results = [];
  for (const station of stations.values()) {
    if (normalize(station.name).includes(normalized)) results.push({ type: "stop", id: station.key, title: station.name, meta: `${station.entries.length}개 운행`, icon: "map-pin" });
    if (results.length >= 15) break;
  }
  for (const route of routes) {
    if (normalize(route).includes(normalized)) results.push({ type: "route", id: route, title: route, meta: "셔틀 노선", icon: "route" });
    if (results.length >= 30) break;
  }
  for (const complex of complexes) {
    if (normalize(complex.name).includes(normalized)) results.push({ type: "apartment", id: complex.id, title: complex.name, meta: `${complex.households.toLocaleString("ko-KR")}세대`, icon: "building-2" });
    if (results.length >= 45) break;
  }
  return results;
}

export function searchResultsHtml(query, results) {
  if (!normalize(query)) return `<div class="empty-search">정류장, 노선 또는 아파트 이름을 입력하세요.</div>`;
  if (!results.length) return `<div class="empty-search">검색 결과가 없습니다.</div>`;
  return results.map(item => `<button class="search-result" type="button" data-search-type="${item.type}" data-search-id="${escapeHtml(item.id)}"><i data-lucide="${item.icon}"></i><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.meta)}</small></span><i data-lucide="chevron-right"></i></button>`).join("");
}
