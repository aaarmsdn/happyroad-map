export function hourOf(value) {
  const hour = String(value || "").split(":", 1)[0];
  return /^\d{1,2}$/.test(hour) ? hour.padStart(2, "0") : "";
}

export function routeTypeOptions(routeTypes) {
  return ["전체", ...routeTypes.filter(type => type !== "전체")];
}

export function selectGlobalRoute(state, route) {
  Object.assign(state, {
    category: "전체",
    route,
    routeType: "전체",
    startHour: "",
    routeQuery: ""
  });
}

export function restoreFilters(state, saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
  for (const key of ["route", "routeType", "routeQuery"]) {
    if (typeof saved[key] === "string") state[key] = saved[key];
  }
  if (["전체", "출근", "퇴근", "기타셔틀", "사내셔틀"].includes(saved.category)) state.category = saved.category;
  if (["", "전체", "59", "84", "102", "115"].includes(saved.area)) state.area = saved.area;
  if (["max", "average", "min"].includes(saved.priceMetric)) state.priceMetric = saved.priceMetric;
  if (["price", "commute", "none"].includes(saved.apartmentColor)) state.apartmentColor = saved.apartmentColor;
  else if (saved.priceColors === false) state.apartmentColor = "none";
  if (saved.startHour === "" || /^(0\d|1\d|2[0-3])$/.test(saved.startHour)) state.startHour = saved.startHour;
  if (Number.isFinite(saved.distance)) state.distance = Math.min(1.5, Math.max(0.2, saved.distance));
  if (Number.isFinite(saved.households)) state.households = Math.max(0, saved.households);
  if (saved.travelTime === null || [45, 60, 75, 90].includes(saved.travelTime)) state.travelTime = saved.travelTime;
  for (const key of ["showStops", "showApartments"]) {
    if (typeof saved[key] === "boolean") state[key] = saved[key];
  }
}
