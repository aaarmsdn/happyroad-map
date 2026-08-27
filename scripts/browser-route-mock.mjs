const ROUTING_HOST = "happyroad-routing.aaarmsdn-happyroad.workers.dev";

export function mockRoutingRequest({ cdp, sessionId, requestId, request, origin }) {
  const url = new URL(request.url);
  const addressRequest = url.pathname === "/address" && request.method === "GET";
  const routeRequest = ["/route", "/routes"].includes(url.pathname) && ["POST", "OPTIONS"].includes(request.method);
  if (url.hostname !== ROUTING_HOST || (!addressRequest && !routeRequest)) return null;
  const responseHeaders = [
    { name: "access-control-allow-origin", value: origin },
    { name: "access-control-allow-methods", value: "POST, OPTIONS" },
    { name: "access-control-allow-headers", value: "content-type" },
    { name: "content-type", value: "application/json" }
  ];
  if (request.method === "OPTIONS") {
    return cdp.call("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders }, sessionId);
  }
  if (addressRequest) {
    const body = Buffer.from(JSON.stringify({ address: "서울 성동구 성수일로 12-3" })).toString("base64");
    return cdp.call("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders, body }, sessionId);
  }
  const route = ({ start, end, mode }) => {
    const minutes = { walk: 12, car: 6, "public-transit": 18 }[mode];
    const distanceMeters = { walk: 900, car: 4200, "public-transit": 5000 }[mode];
    return {
      minutes, distanceMeters,
      fare: mode === "car" ? 6500 : mode === "public-transit" ? 1500 : 0,
      transfers: mode === "public-transit" ? 1 : 0,
      points: [[start.lat, start.lng], [end.lat, end.lng]],
      steps: [{ type: mode === "public-transit" ? "subway" : mode, guidance: "정류장까지 이동", minutes, distanceMeters }]
    };
  };
  const payload = JSON.parse(request.postData);
  const response = url.pathname === "/routes"
    ? { routes: payload.routes.map(item => ({ id: item.id, route: route(item) })) }
    : route(payload);
  const body = Buffer.from(JSON.stringify(response)).toString("base64");
  return cdp.call("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders, body }, sessionId);
}
