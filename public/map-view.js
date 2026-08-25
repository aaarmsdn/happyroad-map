import { escapeHtml, formatPrice } from "./ui-utils.js?v=10";

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

function stopColor(stop) {
  if (stop.entries.some(entry => entry.isCompany)) return "#f04438";
  const categories = new Set(stop.entries.map(entry => entry.routeCategory));
  if (categories.has("출근")) return "#2774ae";
  if (categories.has("퇴근")) return "#18864b";
  if (categories.has("사내셔틀")) return "#7d4cc2";
  return "#ff8a1f";
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
  element?.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    marker.fire("click");
  });
}

function stopIcon(L, stop) {
  return markerIcon(L, `<span class="map-marker stop-marker" style="--route-color:${stopColor(stop)}"><i data-lucide="bus-front"></i></span>`, [44, 44]);
}

function apartmentIcon(L, color) {
  return markerIcon(L, `<span class="map-marker apartment-marker" style="--marker-color:${color}"><i data-lucide="building-2"></i></span>`, [44, 44]);
}

function apartmentPriceIcon(L, value, color) {
  const label = compactPrice(value);
  return label
    ? markerIcon(L, `<span class="apartment-price-marker" style="--marker-color:${color}"><i data-lucide="building-2"></i><b>${label}</b></span>`, [66, 44])
    : apartmentIcon(L, color);
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
  const renderedPoints = [];
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
        const marker = L.marker(map.layerPointToLatLng(summaryPoints[summaryIndex++]), { icon: markerIcon(L, `<span class="map-cluster stop-cluster" style="--cluster-size:${size}px"><i data-lucide="bus-front"></i><b>${cluster.items.length}</b></span>`, [44, 44]), zIndexOffset: 100 });
        marker.bindTooltip(`정류장 ${cluster.items.length.toLocaleString("ko-KR")}개`, { direction: "top" });
        marker.on("click", () => map.setView([cluster.lat, cluster.lng], Math.min(14, map.getZoom() + 2)));
        addAccessibleMarker(marker, layer, `정류장 ${cluster.items.length.toLocaleString("ko-KR")}개`);
        renderedPoints.push(map.latLngToLayerPoint(marker.getLatLng()));
        continue;
      }
      const stop = cluster.items[0];
      const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon(L, stop), zIndexOffset: 300 });
      marker.bindTooltip(escapeHtml(stop.name), { direction: "top" });
      marker.on("click", () => onSelect(stop));
      addAccessibleMarker(marker, layer, stop.name);
      renderedPoints.push(map.latLngToLayerPoint(marker.getLatLng()));
    }
    return renderedPoints;
  }
  stops.forEach(stop => {
    const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon(L, stop), zIndexOffset: 300 });
    marker.bindTooltip(`${escapeHtml(stop.name)} · ${new Set(stop.entries.map(entry => entry.routeName)).size}개 노선`, { direction: "top" });
    marker.on("click", () => onSelect(stop));
    addAccessibleMarker(marker, layer, stop.name);
    renderedPoints.push(map.latLngToLayerPoint(marker.getLatLng()));
  });
  return renderedPoints;
}

export function addApartmentMarkers({ L, map, layer, visibleLinks, complexById, priceOf, perPyeongOf = () => null, colorOf, onSelect, occupiedPoints = [] }) {
  const bounds = map.getBounds().pad(0.2);
  const items = [...visibleLinks]
    .map(([complexId, link]) => ({ complex: complexById.get(complexId), link }))
    .filter(item => bounds.contains([item.complex.lat, item.complex.lng]));
  if (map.getZoom() < 14) {
    const cellSize = 0.05 * 2 ** (11 - map.getZoom());
    const clusters = clusterItems(items, item => [item.complex.lat, item.complex.lng], cellSize);
    const singletonPoints = clusters
      .filter(cluster => cluster.items.length === 1)
      .map(cluster => map.latLngToLayerPoint([cluster.items[0].complex.lat, cluster.items[0].complex.lng]));
    const summaryPoints = spreadMarkerPoints(
      clusters.filter(cluster => cluster.items.length > 1).map(cluster => map.latLngToLayerPoint([cluster.lat, cluster.lng])),
      68,
      [...occupiedPoints, ...singletonPoints]
    );
    let summaryIndex = 0;
    for (const cluster of clusters) {
      const single = cluster.items.length === 1 ? cluster.items[0] : null;
      if (!single) {
        const size = Math.min(42, 25 + Math.log2(cluster.items.length) * 3);
        const marker = L.marker(map.layerPointToLatLng(summaryPoints[summaryIndex++]), { icon: markerIcon(L, `<span class="map-cluster apartment-cluster" style="--cluster-size:${size}px"><i data-lucide="building-2"></i><b>${cluster.items.length}</b></span>`, [44, 44]), zIndexOffset: 200 });
        marker.bindTooltip(`아파트 ${cluster.items.length.toLocaleString("ko-KR")}단지`, { direction: "top" });
        marker.on("click", () => map.setView([cluster.lat, cluster.lng], Math.min(14, map.getZoom() + 2)));
        addAccessibleMarker(marker, layer, `아파트 ${cluster.items.length.toLocaleString("ko-KR")}단지`);
        continue;
      }
      const median = priceOf(single.complex.id);
      const perPyeong = perPyeongOf(single.complex.id);
      const marker = L.marker([single.complex.lat, single.complex.lng], { icon: apartmentPriceIcon(L, median, colorOf(perPyeong)), zIndexOffset: 200 });
      marker.bindTooltip(`${escapeHtml(single.complex.name)}${median ? ` · ${formatPrice(median)}${perPyeong ? ` · 평당 ${perPyeong.toLocaleString("ko-KR")}만` : ""}` : ""}`, { direction: "top" });
      marker.on("click", () => onSelect(single.complex, single.link));
      addAccessibleMarker(marker, layer, single.complex.name);
    }
    return;
  }
  items.forEach(item => {
    const median = priceOf(item.complex.id);
    const perPyeong = perPyeongOf(item.complex.id);
    const color = colorOf(perPyeong);
    const icon = apartmentPriceIcon(L, median, color);
    const marker = L.marker([item.complex.lat, item.complex.lng], { icon, zIndexOffset: 200 });
    marker.bindTooltip(`${escapeHtml(item.complex.name)}${median ? ` · ${formatPrice(median)}${perPyeong ? ` · 평당 ${perPyeong.toLocaleString("ko-KR")}만` : ""}` : ""}`, { direction: "top" });
    marker.on("click", () => onSelect(item.complex, item.link));
    addAccessibleMarker(marker, layer, item.complex.name);
  });
}

export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}
