import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromePaths, connectCdp, freePort, stopProcess, stopProfileProcesses, waitFor } from "./browser-test-runtime.mjs";
import { mockRoutingRequest } from "./browser-route-mock.mjs";

test("mobile browser regressions", { timeout: 30000 }, async t => {
  const chromePath = chromePaths.find(existsSync);
  if (!chromePath) return t.skip("Chrome or Edge is required for browser regression tests.");
  const [appPort, debugPort] = await Promise.all([freePort(), freePort()]);
  const profile = await mkdtemp(path.join(tmpdir(), "happyroad-browser-test-"));
  const app = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, PORT: String(appPort) }, stdio: "ignore"
  });
  const chrome = spawn(chromePath, [
    "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank"
  ], { stdio: "ignore" });

  let cdp;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    cdp?.notify("Browser.close");
    await new Promise(resolve => setTimeout(resolve, 100));
    cdp?.close();
    await Promise.all([stopProcess(app), stopProcess(chrome, true)]);
    await stopProfileProcesses(profile);
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  t.after(cleanup);

  try {
    await waitFor(() => fetch(`http://127.0.0.1:${appPort}/`).then(response => response.ok));
    const version = await waitFor(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.ok ? response.json() : null));
    cdp = await connectCdp(version.webSocketDebuggerUrl);
    const { targetId } = await cdp.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.call("Target.attachToTarget", { targetId, flatten: true });
    const allowedRequests = [];
    const blockedRequests = [];
    const interceptionErrors = [];
    cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
      const mocked = mockRoutingRequest({ cdp, sessionId, requestId, request, origin: `http://127.0.0.1:${appPort}` });
      if (mocked) {
        return void mocked.catch(error => interceptionErrors.push(error));
      }
      const hostname = new URL(request.url).hostname;
      const allowed = hostname === "127.0.0.1" || hostname === "localhost";
      (allowed ? allowedRequests : blockedRequests).push(request.url);
      cdp.call(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" }, sessionId)
        .catch(error => interceptionErrors.push(error));
    });
    await cdp.call("Fetch.enable", { patterns: [{ urlPattern: "http://*" }, { urlPattern: "https://*" }] }, sessionId);
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.call("Browser.grantPermissions", { permissions: ["geolocation"], origin: `http://127.0.0.1:${appPort}` });
    await cdp.call("Emulation.setGeolocationOverride", { latitude: 37.5446, longitude: 127.056, accuracy: 10 }, sessionId);
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${appPort}/?browser-test=${Date.now()}` }, sessionId);
    const evaluate = async expression => {
      const response = await cdp.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result.value;
    };

    await waitFor(() => evaluate("document.readyState === 'complete' && Boolean(document.querySelector('[data-tab=apartment]'))"));
    await waitFor(() => evaluate("document.querySelector('#map').classList.contains('leaflet-container')"));
    await t.test("filter chips expose their selected state", async () => {
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#categoryChips .chip')].map(button => button.getAttribute('aria-pressed'))"), ["true", "false", "false", "false", "false"]);
    await evaluate("document.querySelector('[data-category=출근]').click(); true");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#categoryChips .chip')].map(button => button.getAttribute('aria-pressed'))"), ["false", "true", "false", "false", "false"]);
    await evaluate("document.querySelector('[data-category=전체]').click(); true");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#areaChips .chip')].map(button => button.getAttribute('aria-pressed'))"), ["true", "false", "false", "false", "false"]);
    await evaluate("document.querySelector('[data-area=\"84\"]').click(); document.querySelector('[data-area=\"84\"]').click(); true");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#areaChips .chip')].map(button => button.getAttribute('aria-pressed'))"), ["false", "false", "false", "false", "false"]);
    assert.equal(await evaluate("document.querySelector('#apartmentCount').textContent"), "0개");
    await evaluate("document.querySelector('[data-area=전체]').click(); true");
    });
    await t.test("map picking uses marker names and reverse-geocoded blank-map addresses", async () => {
    await evaluate(`(() => {
      const nativeFetch = window.fetch;
      window.fetch = (input, init) => String(input).includes('/address?')
        ? Promise.resolve(new Response(JSON.stringify({ address: '서울 성동구 성수일로 12-3' }), { status: 200, headers: { 'content-type': 'application/json' } }))
        : nativeFetch(input, init);
      return true;
    })()`);
    await evaluate("document.querySelector('#commuteButton').click(); document.querySelector('#commuteUseCurrentLocation').click(); true");
    await waitFor(() => evaluate("document.querySelector('#commutePointLabel').textContent === '현재 위치'"));
    await evaluate("document.querySelector('#commutePickOnMap').click(); true");
    const markerName = await waitFor(() => evaluate(`(() => {
      const marker = [...document.querySelectorAll('.apartment-price-marker, .stop-marker')]
        .map(item => item.closest('.leaflet-marker-icon[aria-label]')).find(item => item?.getBoundingClientRect().width > 0);
      if (!marker) return null;
      const name = marker.getAttribute('aria-label');
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return name;
    })()`));
    await waitFor(() => evaluate("document.querySelector('#commutePanel').classList.contains('open')"));
    assert.equal(await evaluate("document.querySelector('#commutePointLabel').textContent"), markerName);
    assert.equal(await evaluate("document.querySelector('#commutePlaceQuery').value"), markerName);
    assert.equal(await evaluate("document.querySelector('#detailPanel').classList.contains('open')"), false);
    await evaluate("document.querySelector('#commutePickOnMap').click(); document.querySelector('.leaflet-marker-pane').style.display='none'; true");
    const blankPoint = await evaluate(`(() => {
      const map = document.querySelector('#map').getBoundingClientRect();
      for (let y = Math.max(map.top + 80, 120); y < map.bottom - 40; y += 40) for (let x = map.left + 25; x < map.right - 25; x += 40) {
        const element = document.elementFromPoint(x, y);
        if (element?.closest('#map') && !element.closest('.leaflet-control, .leaflet-marker-icon')) return { x, y };
      }
      return null;
    })()`);
    assert.ok(blankPoint);
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", ...blankPoint, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...blankPoint, button: "left", clickCount: 1 }, sessionId);
    await waitFor(() => evaluate("document.querySelector('#commutePanel').classList.contains('open')"));
    await waitFor(() => evaluate("document.querySelector('#commutePointLabel').textContent === '서울 성동구 성수일로 12-3'"));
    assert.equal(await evaluate("document.querySelector('#commutePlaceQuery').value"), "서울 성동구 성수일로 12-3");
    await evaluate("document.querySelector('.leaflet-marker-pane').style.display=''; document.querySelector('#commuteCloseButton').click(); true");
    });
    await t.test("current location opens a complete commute route without mobile overflow", async () => {
    await evaluate("document.querySelector('#commuteButton').click(); true");
    await waitFor(() => evaluate("document.activeElement.id === 'commuteCloseButton'"));
    await waitFor(() => evaluate("Math.abs(document.querySelector('#commutePanel').getBoundingClientRect().bottom - innerHeight) < 1"));
    const planner = await evaluate(`(() => {
      const panel = document.querySelector('#commutePanel').getBoundingClientRect();
      return { top: panel.top, bottom: panel.bottom, width: panel.width, viewport: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth, mapInert: document.querySelector('#map').hasAttribute('inert') };
    })()`);
    assert.equal(planner.top >= 0, true);
    assert.equal(Math.round(planner.bottom), planner.viewport);
    assert.equal(planner.width, 375);
    assert.equal(planner.overflow, false);
    assert.equal(planner.mapInert, false);
    await evaluate("document.querySelector('#commuteUseCurrentLocation').click(); true");
    await waitFor(() => evaluate("document.querySelector('#commutePointLabel').textContent === '현재 위치'"));
    const selectedPointPixels = await evaluate(`(() => [...document.querySelectorAll('#map canvas')].reduce((total, canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 220 && pixels[index + 1] >= 35 && pixels[index + 1] < 100
          && pixels[index + 2] >= 25 && pixels[index + 2] < 100 && pixels[index + 3] > 0) total += 1;
      }
      return total;
    }, 0))()`);
    assert.equal(selectedPointPixels > 0, true);
    const searchMarkerPoint = await waitFor(() => evaluate(`(() => {
      const panelTop = document.querySelector('#commutePanel').getBoundingClientRect().top;
      const marker = [...document.querySelectorAll('.apartment-price-marker')].map(item => item.closest('.leaflet-marker-icon'))
        .find(item => { const rect = item.getBoundingClientRect(); return rect.bottom > 0 && rect.top < panelTop && rect.right > 0 && rect.left < innerWidth; });
      if (!marker) return null;
      const rect = marker.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`));
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", ...searchMarkerPoint, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...searchMarkerPoint, button: "left", clickCount: 1 }, sessionId);
    assert.equal(await evaluate("document.querySelector('#commutePanel').classList.contains('open')"), false);
    await waitFor(() => evaluate("document.querySelector('#detailPanel').classList.contains('open')"));
    await evaluate("document.querySelector('#detailCloseButton').click(); true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').classList.contains('open')"), true);
    assert.equal(await evaluate("document.querySelector('#commutePlaceQuery').value"), "현재 위치");
    assert.equal(await evaluate("document.querySelector('#commuteUseCurrentLocation').disabled"), false);
    await evaluate(`(() => {
      window.__qaSetViews = [];
      const original = L.Map.prototype.setView;
      L.Map.prototype.setView = function(center, zoom, options) {
        window.__qaSetViews.push({ center: [Number(center.lat ?? center[0]), Number(center.lng ?? center[1])], zoom });
        return original.call(this, center, zoom, options);
      };
      return true;
    })()`);
    if (process.env.QA_SCREENSHOT) {
      const capture = await cdp.call("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(process.env.QA_SCREENSHOT, Buffer.from(capture.data, "base64"));
    }
    await evaluate("document.querySelector('#commuteSearchButton').click(); true");
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-commute-detail]'))"));
    assert.deepEqual(await evaluate(`(() => ({
      walk: document.querySelectorAll('.commute-result.mode-walk').length,
      car: document.querySelectorAll('.commute-result.mode-car').length,
      transit: document.querySelectorAll('.commute-result.mode-public-transit').length
    }))()`), { walk: 1, car: 1, transit: 3 });
    assert.match(await evaluate("document.querySelector('.commute-result.mode-walk').textContent"), /분 \(\d+\.\d+km\)/);
    assert.match(await evaluate("document.querySelector('.commute-result.mode-car').textContent"), /분 \(\d+\.\d+km\)/);
    assert.equal(await evaluate("document.querySelector('.commute-result.mode-public-transit').getBoundingClientRect().top < innerHeight"), true);
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    assert.deepEqual(await evaluate("window.__qaSetViews.at(-1)"), { center: [37.5446, 127.056], zoom: 14 });
    assert.equal(await evaluate(`(() => [...document.querySelectorAll('#map canvas')].reduce((total, canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 220 && pixels[index + 1] >= 35 && pixels[index + 1] < 100
          && pixels[index + 2] >= 25 && pixels[index + 2] < 100 && pixels[index + 3] > 0) total += 1;
      }
      return total;
    }, 0))()`), 0);
    assert.deepEqual(await evaluate(`(() => ({
      stage: document.querySelector('#commutePanel').dataset.stage,
      searchHidden: document.querySelector('#commuteSearchView').hidden,
      resultsHidden: document.querySelector('#commuteResults').hidden,
      title: document.querySelector('#commuteStageTitle').textContent,
      query: document.querySelector('#commutePlaceQuery').value,
      focus: document.activeElement.id
    }))()`), { stage: "results", searchHidden: true, resultsHidden: false, title: "추천 경로", query: "현재 위치", focus: "commuteStageBack" });
    await evaluate("document.querySelector('#commuteStageBack').click(); true");
    assert.deepEqual(await evaluate(`(() => ({
      stage: document.querySelector('#commutePanel').dataset.stage,
      searchHidden: document.querySelector('#commuteSearchView').hidden,
      resultsHidden: document.querySelector('#commuteResults').hidden,
      query: document.querySelector('#commutePlaceQuery').value,
      focus: document.activeElement.id
    }))()`), { stage: "search", searchHidden: false, resultsHidden: true, query: "현재 위치", focus: "commutePlaceQuery" });
    await evaluate("document.querySelector('#commuteSearchButton').click(); true");
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-commute-detail]'))"));
    await evaluate("document.querySelector('[data-commute-detail]').click(); true");
    await waitFor(() => evaluate("document.querySelector('#commutePanel').dataset.stage === 'detail'"));
    assert.equal(await evaluate("document.activeElement.id"), "commuteStageBack");
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    const commuteRouteKey = await evaluate("document.querySelector('#map').dataset.routeKey");
    assert.match(commuteRouteKey, /^commute:/);
    const markerPoint = await waitFor(() => evaluate(`(() => {
      const panelTop = document.querySelector('#commutePanel').getBoundingClientRect().top;
      const marker = [...document.querySelectorAll('.apartment-price-marker')].map(item => item.closest('.leaflet-marker-icon'))
        .find(item => { const rect = item.getBoundingClientRect(); return rect.bottom > 0 && rect.top < panelTop && rect.right > 0 && rect.left < innerWidth; });
      if (!marker) return null;
      const rect = marker.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`));
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", ...markerPoint, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...markerPoint, button: "left", clickCount: 1 }, sessionId);
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "detail");
    assert.equal(await evaluate("document.querySelector('#commutePanel').classList.contains('open')"), false);
    assert.equal(await evaluate("document.querySelector('#detailPanel').classList.contains('open')"), true);
    await evaluate("document.querySelector('.apartment-price-marker').closest('.leaflet-marker-icon').click(); true");
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeKey"), commuteRouteKey);
    await evaluate("document.querySelector('#detailCloseButton').click(); true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').classList.contains('open')"), true);
    assert.equal(await evaluate("document.activeElement.id"), "commuteStageBack");
    const stopPoint = await waitFor(() => evaluate(`(() => {
      const panelTop = document.querySelector('#commutePanel').getBoundingClientRect().top;
      const marker = [...document.querySelectorAll('.stop-marker')].map(item => item.closest('.leaflet-marker-icon'))
        .find(item => { const rect = item.getBoundingClientRect(); return rect.bottom > 0 && rect.top < panelTop && rect.right > 0 && rect.left < innerWidth; });
      if (!marker) return null;
      const rect = marker.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`));
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", ...stopPoint, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...stopPoint, button: "left", clickCount: 1 }, sessionId);
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeKey"), commuteRouteKey);
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "detail");
    assert.equal(await evaluate("document.querySelector('#detailPanel').classList.contains('open')"), true);
    await evaluate("document.querySelector('#detailCloseButton').click(); true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').classList.contains('open')"), true);
    await waitFor(() => evaluate("Math.abs(document.querySelector('#commutePanel').getBoundingClientRect().bottom - innerHeight) < 1"));
    const compactHeight = await evaluate("document.querySelector('#commutePanel').getBoundingClientRect().height");
    assert.equal(compactHeight <= 812 * 0.34, true);
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 180, y: 700, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 180, y: 700, button: "left", clickCount: 1 }, sessionId);
    const expandedState = await evaluate(`(() => { const panel = document.querySelector('#commutePanel'); return { height: panel.getBoundingClientRect().height, className: panel.className, target: document.elementFromPoint(180, 700)?.className || document.elementFromPoint(180, 700)?.tagName }; })()`);
    assert.equal(expandedState.height >= 812 * 0.6, true, JSON.stringify(expandedState));
    const zoomPoint = await evaluate(`(() => {
      const panelTop = document.querySelector('#commutePanel').getBoundingClientRect().top;
      for (let y = 90; y < panelTop - 30; y += 24) for (let x = 30; x < innerWidth - 30; x += 24) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest('#map') && !target.closest('.leaflet-marker-icon, .leaflet-control, .app-bar')) return { x, y };
      }
      return null;
    })()`);
    const zoomAnchorBefore = await evaluate(`(() => {
      const marker = [...document.querySelectorAll('.leaflet-marker-icon')]
        .filter(item => { const rect = item.getBoundingClientRect(); return rect.bottom > 0 && rect.top < 260 && rect.right > 0 && rect.left < innerWidth; })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
          return Math.hypot(br.x - ${zoomPoint.x}, br.y - ${zoomPoint.y}) - Math.hypot(ar.x - ${zoomPoint.x}, ar.y - ${zoomPoint.y});
        })[0];
      marker.dataset.qaZoomAnchor = '';
      const rect = marker.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    })()`);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", ...zoomPoint, deltaX: 0, deltaY: -300 }, sessionId);
    await waitFor(() => evaluate(`(() => { const rect = document.querySelector('[data-qa-zoom-anchor]').getBoundingClientRect(); return Math.hypot(rect.x - ${zoomAnchorBefore.x}, rect.y - ${zoomAnchorBefore.y}) > 5; })()`));
    await waitFor(() => evaluate("!document.querySelector('#map').classList.contains('leaflet-zoom-anim')"));
    assert.equal(await evaluate("document.querySelector('#commutePanel').getBoundingClientRect().height <= innerHeight * 0.34"), true);
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "detail");
    await new Promise(resolve => setTimeout(resolve, 350));
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 180, y: 700, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 180, y: 700, button: "left", clickCount: 1 }, sessionId);
    const mapTransformBefore = await evaluate("document.querySelector('.leaflet-map-pane').style.transform");
    const dragPoint = await evaluate(`(() => {
      const panelTop = document.querySelector('#commutePanel').getBoundingClientRect().top;
      for (let y = 90; y < panelTop - 70; y += 24) for (let x = 70; x < innerWidth - 70; x += 24) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest('#map') && !target.closest('.leaflet-marker-icon, .leaflet-control, .app-bar')) return { x, y };
      }
      return null;
    })()`);
    const dragEnd = { x: dragPoint.x < 375 / 2 ? dragPoint.x + 50 : dragPoint.x - 50, y: dragPoint.y + 40 };
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...dragPoint, button: "none", buttons: 0 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", ...dragPoint, button: "left", buttons: 1, clickCount: 1 }, sessionId);
    await new Promise(resolve => setTimeout(resolve, 30));
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragPoint.x + (dragEnd.x - dragPoint.x) / 3, y: dragPoint.y + 13, button: "left", buttons: 1 }, sessionId);
    await new Promise(resolve => setTimeout(resolve, 30));
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragPoint.x + (dragEnd.x - dragPoint.x) * 2 / 3, y: dragPoint.y + 27, button: "left", buttons: 1 }, sessionId);
    await new Promise(resolve => setTimeout(resolve, 30));
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...dragEnd, button: "left", buttons: 1 }, sessionId);
    assert.notEqual(await evaluate("document.querySelector('.leaflet-map-pane').style.transform"), mapTransformBefore);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...dragEnd, button: "left", clickCount: 1 }, sessionId);
    assert.equal(await evaluate("document.querySelector('#commutePanel').getBoundingClientRect().height <= innerHeight * 0.34"), true);
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "true");
    await evaluate("document.querySelector('#commuteStageBack').click(); true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "results");
    await evaluate("document.querySelector('#commuteStageBack').click(); true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "search");
    await evaluate("document.querySelector('[data-commute-mode=from-company]').click(); true");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-commute-mode]')].map(button => button.getAttribute('aria-pressed'))"), ["false", "true"]);
    assert.equal(await evaluate("document.querySelector('#map').dataset.routeVisible"), "false");

    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await waitFor(() => evaluate("!document.querySelector('#commutePanel').classList.contains('open')"));
    assert.equal(await evaluate("document.activeElement.id"), "commuteButton");

    await evaluate("document.querySelector('#map').dataset.routeVisible = 'true'; true");
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 280, y: 180, button: "left", clickCount: 1 }, sessionId);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 280, y: 180, button: "left", clickCount: 1 }, sessionId);
    await waitFor(() => evaluate("document.querySelector('#map').dataset.routeVisible === 'false'"));
    await cdp.call("Page.reload", { ignoreCache: true }, sessionId);
    await waitFor(() => evaluate("document.readyState === 'complete' && document.querySelector('#map').classList.contains('leaflet-container')"));
    });

    await t.test("closing invalidates an in-flight commute search", async () => {
    await evaluate("document.querySelector('#commuteButton').click(); document.querySelector('#commuteUseCurrentLocation').click(); true");
    await waitFor(() => evaluate("document.querySelector('#commutePointLabel').textContent === '현재 위치'"));
    await evaluate(`(() => {
      const original = window.fetch;
      window.__pendingRouteFetches = [];
      window.__restoreRouteFetch = () => { window.fetch = original; };
      window.fetch = (...args) => String(args[0]).endsWith('/routes')
        ? new Promise((resolve, reject) => window.__pendingRouteFetches.push(() => original(...args).then(resolve, reject)))
        : original(...args);
    })()`);
    await evaluate("document.querySelector('#commuteSearchButton').click(); true");
    await waitFor(() => evaluate("window.__pendingRouteFetches.length > 0"));
    await evaluate("document.querySelector('#commuteCloseButton').click(); document.querySelector('#commuteButton').click(); true");
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "search");
    await evaluate("window.__restoreRouteFetch(); window.__pendingRouteFetches.splice(0).forEach(release => release()); true");
    await evaluate("new Promise(resolve => setTimeout(resolve, 500))");
    assert.equal(await evaluate("document.querySelector('#commutePanel').dataset.stage"), "search");
    assert.equal(await evaluate("document.querySelector('#commuteResults').hidden"), true);
    await cdp.call("Page.reload", { ignoreCache: true }, sessionId);
    await waitFor(() => evaluate("document.readyState === 'complete' && document.querySelector('#map').classList.contains('leaflet-container')"));
    });

    await t.test("apartment price metric persists independently", async () => {
    await evaluate("localStorage.clear(); document.querySelector('[data-tab=apartment]').click(); true");
    await waitFor(() => evaluate(`(() => {
      if (document.querySelector('.apartment-price-marker')) return true;
      document.querySelector('.apartment-cluster')?.closest('.leaflet-marker-icon')?.click();
      return false;
    })()`));
    const maxMarker = await evaluate("document.querySelector('.apartment-price-marker b').textContent.trim()");
    await evaluate("document.querySelector('.apartment-price-marker').closest('.leaflet-marker-icon').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); true");
    await waitFor(() => evaluate("document.querySelector('#detailPanel').classList.contains('open')"));
    assert.equal(await evaluate("document.querySelector('[data-price-metric].active').dataset.priceMetric"), "max");
    await evaluate("document.querySelector('[data-price-metric=average]').click(); true");
    assert.match(await evaluate("document.querySelector('#detailPanel .detail-subtitle').textContent"), /평균값/);
    await evaluate("document.querySelector('[data-price-metric=min]').click(); true");
    const minMarker = await waitFor(() => evaluate("document.querySelector('.apartment-price-marker b')?.textContent.trim()"));
    assert.notEqual(minMarker, maxMarker);
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('happyroad.filters')).priceMetric"), "min");
    });

    await t.test("stale geolocation callbacks cannot override close or place selection", async () => {
    const staleLocation = await evaluate(`(() => {
      document.querySelector('#detailCloseButton').click(); document.querySelector('#commuteButton').click();
      const requests = []; Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success, error) { requests.push({ success, error }); } } });
      const toast = document.querySelector('#toast'), button = document.querySelector('#commuteUseCurrentLocation'), close = document.querySelector('#commuteCloseButton'), open = document.querySelector('#commuteButton');
      toast.classList.remove('show'); toast.textContent = ''; button.click(); close.click(); requests[0].error();
      const lateError = { busy: button.hasAttribute('aria-busy'), disabled: button.disabled, toast: toast.textContent, shown: toast.classList.contains('show') };
      open.click(); button.click(); close.click(); open.click(); button.click(); requests[1].success({ coords: { latitude: 37.54, longitude: 127.05 } });
      const lateSuccess = { busy: button.hasAttribute('aria-busy'), disabled: button.disabled }; requests[2].success({ coords: { latitude: 37.55, longitude: 127.06 } });
      const activeSuccess = { busy: button.hasAttribute('aria-busy'), disabled: button.disabled };
      button.click(); const results = document.querySelector('#commutePlaceResults'); results._places = [{ name: '검색 위치', address: '', lat: 37.56, lng: 127.07 }]; results.innerHTML = '<button data-commute-place="0">검색 위치</button>'; results.querySelector('button').click(); requests[3].success({ coords: { latitude: 37.57, longitude: 127.08 } });
      return { lateError, lateSuccess, activeSuccess, placeSelection: { busy: button.hasAttribute('aria-busy'), disabled: button.disabled, label: document.querySelector('#commutePointLabel').textContent } };
    })()`);
    assert.deepEqual(staleLocation, { lateError: { busy: false, disabled: false, toast: "", shown: false }, lateSuccess: { busy: true, disabled: true }, activeSuccess: { busy: false, disabled: false }, placeSelection: { busy: false, disabled: false, label: "검색 위치" } });
    });
    assert.equal(interceptionErrors.length, 0);
    assert.equal(allowedRequests.every(url => ["127.0.0.1", "localhost"].includes(new URL(url).hostname)), true);
    assert.equal(blockedRequests.every(url => !["127.0.0.1", "localhost"].includes(new URL(url).hostname)), true);
    await cdp.call("Target.closeTarget", { targetId });
  } finally {
    await cleanup();
  }
});
