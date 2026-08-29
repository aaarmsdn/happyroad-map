import { escapeHtml, formatPrice } from "./ui-utils.js?v=10";
import { stopRepresentativeMinutes } from "./filter-data.js?v=39";

function clusterItems(items, pointOf, cellSize) {
  const buckets = new Map();
  for (const item of items) {
    const [lat, lng] = pointOf(item);
    const key = `${Math.floor(lat / cellSize)}:${Math.floor(lng / cellSize)}`;
    if (!buckets.has(key)) buckets.set(key, { items: [], lat: 0, lng: 0 });
    const bucket = buckets.get(key);
    bucket.items.push(item);
    bucket.lat += lat;
    bucket.lng += lng;
  }
  return [...buckets.values()].map(bucket => ({ ...bucket, lat: bucket.lat / bucket.items.length, lng: bucket.lng / bucket.items.length }));
}

export function stopTimeColor(minutes) {
  if (!Number.isFinite(minutes)) return "#7d4cc2";
  if (minutes < 30) return "#18864b";
  if (minutes < 60) return "#2774ae";
  if (minutes < 90) return "#d6a01d";
  if (minutes < 120) return "#f07835";
  return "#d83a3a";
}

function markerInk(color) {
  return ["#d6a01d", "#f07835"].includes(color) ? "#14213d" : "#ffffff";
}

function stopColor(stop) {
  return stopTimeColor(stopRepresentativeMinutes(stop.entries));
}

function compactPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (amount < 10000) return `${Math.round(amount).toLocaleString("ko-KR")}만`;
  const eok = amount / 10000;
  return `${Number.isInteger(eok) ? eok : eok.toFixed(1)}억`;
}

function markerIcon(L, html, size) {
  return L.divIcon({
    className: "map-marker-shell",
    html,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2]
  });
}

export function spreadMarkerPoints(points, minDistance = 32, occupiedPoints = []) {
  const placed = [...occupiedPoints];
  return points.map(point => {
    const overlaps = candidate => placed.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) < minDistance);
    if (!overlaps(point)) {
      placed.push(point);
      return point;
    }
    for (let step = 0; ; step += 1) {
      const ring = Math.floor(step / 8) + 1;
      const angle = (step % 8) * Math.PI / 4;
      const candidate = { x: point.x + Math.cos(angle) * minDistance * ring, y: point.y + Math.sin(angle) * minDistance * ring };
      if (!overlaps(candidate)) {
        placed.push(candidate);
        return candidate;
      }
    }
  });
}

function addAccessibleMarker(marker, layer, label) {
  marker.addTo(layer);
  const element = marker.getElement();
  element?.setAttribute("aria-label", label);
  element?.setAttribute("role", "button");
  element?.setAttribute("tabindex", "0");
  element?.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    marker.fire("click");
  });
}

export function stopDirectionIcon(stop) {
  const directions = new Set(stop.entries.map(entry => entry.direction));
  if (directions.has("출근") && directions.has("퇴근")) return "arrow-left-right";
  if (directions.has("출근")) return "arrow-right";
  if (directions.has("퇴근")) return "arrow-left";
  return "";
}

export function apartmentDirectionOpacity(link, category) {
  if (category !== "전체") return 1;
  const directions = new Set(link?.accessDirections);
  if (!directions.has("출근") && !directions.has("퇴근")) return 1;
  return directions.has("출근") && directions.has("퇴근") ? 1 : 0.45;
}

function stopIcon(L, stop) {
  const directionIcon = stopDirectionIcon(stop);
  const direction = directionIcon ? `<span class="stop-direction" aria-hidden="true"><i data-lucide="${directionIcon}"></i></span>` : "";
  return markerIcon(L, `<span class="map-marker stop-marker${directionIcon ? " has-direction" : ""}" style="--route-color:${stopColor(stop)}"><i data-lucide="bus-front"></i>${direction}</span>`, [44, 44]);
}

function apartmentIcon(L, color, opacity) {
  return markerIcon(L, `<span class="map-marker apartment-marker" style="--marker-color:${color};opacity:${opacity}"><i data-lucide="building-2"></i></span>`, [44, 44]);
}

function apartmentPriceIcon(L, value, color, opacity) {
  const label = compactPrice(value);
  return label
    ? markerIcon(L, `<span class="apartment-price-marker" style="--marker-color:${color};opacity:${opacity}"><i data-lucide="building-2"></i><b>${label}</b></span>`, [66, 44])
    : apartmentIcon(L, color, opacity);
}

const schoolLevelLabels = { elementary: "초", middle: "중", high: "고" };
const schoolLevelNames = { elementary: "초등학교", middle: "중학교", high: "고등학교" };

function schoolIcon(L, level, count = null) {
  const clusterClass = count ? " school-cluster" : "";
  const countHtml = count ? `<b>${count}</b>` : "";
  const label = schoolLevelLabels[level] || "학";
  return markerIcon(L, `<span class="school-marker ${level}${clusterClass}" aria-label="${label}"><i data-lucide="graduation-cap" aria-hidden="true"></i><span class="school-level" aria-hidden="true">${label}</span>${countHtml}</span>`, [40, 40]);
}

export function addSchoolMarkers({ L, map, layer, schools, onSelect }) {
  const bounds = map.getBounds().pad(0.2);
  const visible = schools.filter(school => bounds.contains([school.lat, school.lng]));
  if (map.getZoom() < 14) {
    const cellSize = 0.05 * 2 ** (13 - map.getZoom());
    for (const level of Object.keys(schoolLevelLabels)) {
      const clusters = clusterItems(visible.filter(school => school.level === level), school => [school.lat, school.lng], cellSize);
      for (const cluster of clusters) {
        if (cluster.items.length === 1) {
          const school = cluster.items[0];
          const marker = L.marker([school.lat, school.lng], { icon: schoolIcon(L, level), zIndexOffset: 150 });
          marker.bindTooltip(escapeHtml(school.name), { direction: "top" });
          marker.on("click", () => onSelect(school));
          addAccessibleMarker(marker, layer, school.name);
          continue;
        }
        const marker = L.marker([cluster.lat, cluster.lng], { icon: schoolIcon(L, level, cluster.items.length), zIndexOffset: 150 });
        const label = `${schoolLevelNames[level]} ${cluster.items.length.toLocaleString("ko-KR")}개`;
        marker.bindTooltip(label, { direction: "top" });
        marker.on("click", () => map.setView([cluster.lat, cluster.lng], Math.min(14, map.getZoom() + 2)));
        addAccessibleMarker(marker, layer, label);
      }
    }
    return;
  }
  visible.forEach(school => {
    const marker = L.marker([school.lat, school.lng], { icon: schoolIcon(L, school.level), zIndexOffset: 150 });
    marker.bindTooltip(escapeHtml(school.name), { direction: "top" });
    marker.on("click", () => onSelect(school));
    addAccessibleMarker(marker, layer, school.name);
  });
}

export function groupStops(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    const key = entry.stationUid || `${entry.station}|${Number(entry.lat).toFixed(5)}|${Number(entry.lng).toFixed(5)}`;
    if (!grouped.has(key)) grouped.set(key, { key, name: entry.station, lat: entry.lat, lng: entry.lng, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return grouped;
}

export function addStopMarkers({ L, map, layer, groupedStops, onSelect }) {
  const bounds = map.getBounds().pad(0.2);
  const stops = [...groupedStops.values()].filter(stop => bounds.contains([stop.lat, stop.lng]));
  if (map.getZoom() < 14) {
    const cellSize = 0.0125 * 2 ** (13 - map.getZoom());
    const clusters = clusterItems(stops, stop => [stop.lat, stop.lng], cellSize);
    const singletonPoints = clusters
      .filter(cluster => cluster.items.length === 1)
      .map(cluster => map.latLngToLayerPoint([cluster.items[0].lat, cluster.items[0].lng]));
    const summaryPoints = spreadMarkerPoints(
      clusters.filter(cluster => cluster.items.length > 1).map(cluster => map.latLngToLayerPoint([cluster.lat, cluster.lng])),
      42,
      singletonPoints
    );
    let summaryIndex = 0;
    for (const cluster of clusters) {
      if (cluster.items.length > 1) {
        const size = Math.min(42, 25 + Math.log2(cluster.items.length) * 3);
        const times = cluster.items.map(stop => stopRepresentativeMinutes(stop.entries)).filter(Number.isFinite);
        const average = times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null;
        const clusterColor = stopTimeColor(average);
        const marker = L.marker(map.layerPointToLatLng(summaryPoints[summaryIndex++]), { icon: markerIcon(L, `<span class="map-cluster stop-cluster" style="--cluster-size:${size}px;--route-color:${clusterColor}"><i data-lucide="bus-front"></i><b>${cluster.items.length}</b></span>`, [44, 44]), zIndexOffset: 300 });
        marker.bindTooltip(`정류장 ${cluster.items.length.toLocaleString("ko-KR")}개${Number.isFinite(average) ? ` · 평균 ${average}분` : ""}`, { direction: "top" });
        marker.on("click", () => map.setView([cluster.lat, cluster.lng], Math.min(14, map.getZoom() + 2)));
        addAccessibleMarker(marker, layer, `정류장 ${cluster.items.length.toLocaleString("ko-KR")}개`);
        continue;
      }
      const stop = cluster.items[0];
      const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon(L, stop), zIndexOffset: 300 });
      marker.bindTooltip(escapeHtml(stop.name), { direction: "top" });
      marker.on("click", () => onSelect(stop));
      addAccessibleMarker(marker, layer, stop.name);
    }
    return;
  }
  stops.forEach(stop => {
    const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon(L, stop), zIndexOffset: 300 });
    marker.bindTooltip(`${escapeHtml(stop.name)} · ${new Set(stop.entries.map(entry => entry.routeName)).size}개 노선`, { direction: "top" });
    marker.on("click", () => onSelect(stop));
    addAccessibleMarker(marker, layer, stop.name);
  });
}

export function addApartmentMarkers({ L, map, layer, visibleLinks, complexById, priceOf, perPyeongOf = () => null, roundTripOf = () => null, colorMode = "price", colorOf, onSelect, category }) {
  const bounds = map.getBounds().pad(0.2);
  const items = [...visibleLinks]
    .map(([complexId, link]) => ({ complex: complexById.get(complexId), link }))
    .filter(item => bounds.contains([item.complex.lat, item.complex.lng]));
  if (map.getZoom() < 14) {
    const cellSize = 0.05 * 2 ** (11 - map.getZoom());
    const clusters = clusterItems(items, item => [item.complex.lat, item.complex.lng], cellSize);
    for (const cluster of clusters) {
      const single = cluster.items.length === 1 ? cluster.items[0] : null;
      if (!single) {
        const size = Math.min(42, 25 + Math.log2(cluster.items.length) * 3);
        const representative = cluster.items.reduce((nearest, item) => {
          const distance = (item.complex.lat - cluster.lat) ** 2 + (item.complex.lng - cluster.lng) ** 2;
          return distance < nearest.distance ? { item, distance } : nearest;
        }, { item: cluster.items[0], distance: Infinity }).item;
        const values = cluster.items.map(item => colorMode === "commute" ? roundTripOf(item.complex.id) : colorMode === "price" ? perPyeongOf(item.complex.id) : null)
          .filter(value => Number.isFinite(value) && value > 0);
        const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
        const opacity = cluster.items.reduce((sum, item) => sum + apartmentDirectionOpacity(item.link, category), 0) / cluster.items.length;
        const summary = colorMode === "commute" && average ? ` · 평균 왕복 ${average}분`
          : colorMode === "price" && average ? ` · 평균 평당 ${average.toLocaleString("ko-KR")}만` : "";
        const label = `아파트 ${cluster.items.length.toLocaleString("ko-KR")}단지${summary}`;
        const clusterColor = colorOf(average);
        const marker = L.marker([representative.complex.lat, representative.complex.lng], { icon: markerIcon(L, `<span class="map-cluster apartment-cluster" style="--cluster-size:${size}px;--marker-color:${clusterColor};--cluster-ink:${markerInk(clusterColor)};opacity:${opacity}"><i data-lucide="building-2"></i><b>${cluster.items.length}</b></span>`, [44, 44]), zIndexOffset: 200 });
        marker.bindTooltip(label, { direction: "top" });
        marker.on("click", () => map.setView([representative.complex.lat, representative.complex.lng], Math.min(14, map.getZoom() + 2)));
        addAccessibleMarker(marker, layer, label);
        continue;
      }
      const price = priceOf(single.complex.id);
      const perPyeong = perPyeongOf(single.complex.id);
      const roundTrip = colorMode === "commute" ? roundTripOf(single.complex.id) : null;
      const metric = colorMode === "commute" ? roundTrip : colorMode === "price" ? perPyeong : null;
      const metricLabel = colorMode === "commute" && roundTrip ? ` · 왕복 ${roundTrip}분`
        : colorMode === "price" && perPyeong ? ` · 평당 ${perPyeong.toLocaleString("ko-KR")}만` : "";
      const marker = L.marker([single.complex.lat, single.complex.lng], { icon: apartmentPriceIcon(L, price, colorOf(metric), apartmentDirectionOpacity(single.link, category)), zIndexOffset: 200 });
      marker.bindTooltip(`${escapeHtml(single.complex.name)}${price ? ` · ${formatPrice(price)}` : ""}${metricLabel}`, { direction: "top" });
      marker.on("click", event => onSelect(single.complex, event.target.getElement()));
      addAccessibleMarker(marker, layer, single.complex.name);
    }
    return;
  }
  items.forEach(item => {
    const price = priceOf(item.complex.id);
    const perPyeong = perPyeongOf(item.complex.id);
    const roundTrip = colorMode === "commute" ? roundTripOf(item.complex.id) : null;
    const metric = colorMode === "commute" ? roundTrip : colorMode === "price" ? perPyeong : null;
    const color = colorOf(metric);
    const icon = apartmentPriceIcon(L, price, color, apartmentDirectionOpacity(item.link, category));
    const marker = L.marker([item.complex.lat, item.complex.lng], { icon, zIndexOffset: 200 });
    const metricLabel = colorMode === "commute" && roundTrip ? ` · 왕복 ${roundTrip}분`
      : colorMode === "price" && perPyeong ? ` · 평당 ${perPyeong.toLocaleString("ko-KR")}만` : "";
    marker.bindTooltip(`${escapeHtml(item.complex.name)}${price ? ` · ${formatPrice(price)}` : ""}${metricLabel}`, { direction: "top" });
    marker.on("click", event => onSelect(item.complex, event.target.getElement()));
    addAccessibleMarker(marker, layer, item.complex.name);
  });
}
