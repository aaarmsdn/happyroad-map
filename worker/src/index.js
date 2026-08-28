import { koreaPoint, routeResult } from "./normalize.js";

const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    vary: "origin"
  }
});

const allowedOrigin = (request, env) => {
  const origin = request.headers.get("origin") || "";
  return String(env.ALLOWED_ORIGIN || "").split(",").map(value => value.trim()).includes(origin) ? origin : "";
};

class KakaoError extends Error {
  constructor(status, code) {
    super(`Kakao API ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function limitedResponseText(response, limit) {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > limit) throw new Error("upstream_too_large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("upstream_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function kakao(url, env, fetcher, responseLimit = 2_000_000) {
  const response = await fetcher(String(url), {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000)
  });
  const text = await limitedResponseText(response, responseLimit);
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok) throw new KakaoError(response.status, Number.isInteger(payload?.code) ? payload.code : null);
  return payload;
}

async function routeBody(request, limit = 1024) {
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach(chunk => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validDepartureTime(value, now = Date.now()) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(wallClock);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute) return false;
  const timestamp = wallClock - 9 * 60 * 60 * 1000;
  return timestamp > now && timestamp <= now + 7 * 24 * 60 * 60 * 1000;
}

const validRoute = body => body && koreaPoint(body.start) && koreaPoint(body.end)
  && ["car", "walk", "public-transit"].includes(body.mode)
  && (body.departureTime === undefined || (body.mode === "car" && validDepartureTime(body.departureTime)));

const futureRouteAuthorized = (request, env, routes) => !routes.some(route => route.departureTime)
  || Boolean(env.SHUTTLE_ESTIMATE_TOKEN)
    && request.headers.get("x-happyroad-estimate-token") === env.SHUTTLE_ESTIMATE_TOKEN;

async function resolveRoute(body, env, fetcher) {
  const upstream = body.mode === "car"
    ? new URL(`https://apis-navi.kakaomobility.com/v1/${body.departureTime ? "future/" : ""}directions`)
    : new URL(`https://dapi.kakao.com/v2/routing/${body.mode === "walk" ? "walk" : "publictraffic"}`);
  if (body.mode === "car") {
    upstream.searchParams.set("origin", `${body.start.lng},${body.start.lat}`);
    upstream.searchParams.set("destination", `${body.end.lng},${body.end.lat}`);
    if (body.departureTime) upstream.searchParams.set("departure_time", body.departureTime);
    upstream.searchParams.set("summary", "false");
  } else {
    upstream.searchParams.set("start_x", body.start.lng);
    upstream.searchParams.set("start_y", body.start.lat);
    upstream.searchParams.set("end_x", body.end.lng);
    upstream.searchParams.set("end_y", body.end.lat);
  }
  return routeResult(await kakao(upstream, env, fetcher, 425_000), body.mode, body.start, body.end);
}

export async function handleRequest(request, env, fetcher = fetch) {
  const origin = allowedOrigin(request, env);
  if (!origin) return json({ error: "forbidden_origin" }, 403, "null");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: json({}, 200, origin).headers });
  if (!env.ROUTE_RATE_LIMITER) return json({ error: "rate_limiter_unavailable" }, 503, origin);
  const actor = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.ROUTE_RATE_LIMITER.limit({ key: actor });
  if (!success) return json({ error: "rate_limited" }, 429, origin);
  if (!env.KAKAO_REST_API_KEY) return json({ error: "missing_api_key" }, 503, origin);
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/places") {
      const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
      if (!query) return json({ error: "missing_query" }, 400, origin);
      const upstream = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
      upstream.searchParams.set("query", query);
      upstream.searchParams.set("size", "12");
      const payload = await kakao(upstream, env, fetcher);
      return json((payload.documents || []).map(place => ({
        name: place.place_name,
        address: place.road_address_name || place.address_name,
        lat: Number(place.y),
        lng: Number(place.x)
      })).filter(koreaPoint), 200, origin);
    }
    if (request.method === "GET" && url.pathname === "/address") {
      const point = { lat: Number(url.searchParams.get("lat")), lng: Number(url.searchParams.get("lng")) };
      if (!koreaPoint(point)) return json({ error: "invalid_point" }, 400, origin);
      const upstream = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
      upstream.searchParams.set("x", point.lng);
      upstream.searchParams.set("y", point.lat);
      const document = (await kakao(upstream, env, fetcher))?.documents?.[0];
      const road = document?.road_address;
      const buildingNo = [road?.main_building_no, road?.sub_building_no].filter(value => value && value !== "0").join("-");
      const address = [road?.region_1depth_name, road?.region_2depth_name, road?.road_name, buildingNo]
        .map(value => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").slice(0, 100);
      return address ? json({ address }, 200, origin) : json({ error: "address_not_found" }, 404, origin);
    }
    if (request.method === "POST" && url.pathname === "/routes") {
      const body = await routeBody(request, 8192);
      if (!Array.isArray(body?.routes) || !body.routes.length || body.routes.length > 27
        || body.routes.some((route, index) => route.id !== index || !validRoute(route))) {
        return json({ error: "invalid_routes" }, 400, origin);
      }
      if (!futureRouteAuthorized(request, env, body.routes)) return json({ error: "forbidden_future_route" }, 403, origin);
      for (let index = 1; index < body.routes.length; index += 1) {
        const allowance = await env.ROUTE_RATE_LIMITER.limit({ key: actor });
        if (!allowance.success) return json({ error: "rate_limited" }, 429, origin);
      }
      const resolved = await Promise.all(body.routes.map(async route => {
        try { return { id: route.id, route: await resolveRoute(route, env, fetcher), failed: false }; }
        catch { return { id: route.id, route: null, failed: true }; }
      }));
      if (resolved.every(result => result.failed)) return json({ error: "upstream_unavailable" }, 502, origin);
      const routes = resolved.map(({ id, route }) => ({ id, route }));
      return json({ routes }, 200, origin);
    }
    if (request.method === "POST" && url.pathname === "/route") {
      const body = await routeBody(request);
      if (!validRoute(body)) {
        return json({ error: "invalid_route" }, 400, origin);
      }
      if (!futureRouteAuthorized(request, env, [body])) return json({ error: "forbidden_future_route" }, 403, origin);
      const result = await resolveRoute(body, env, fetcher);
      return result ? json(result, 200, origin) : json({ error: "route_not_found" }, 404, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  } catch (error) {
    if (error instanceof KakaoError) {
      const detail = { error: "kakao_upstream", status: error.status };
      if (error.code !== null) detail.code = error.code;
      return json(detail, 502, origin);
    }
    return json({ error: "upstream_unavailable" }, 502, origin);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
