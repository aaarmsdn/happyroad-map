import assert from "node:assert/strict";
import test from "node:test";
import { nearestSchools } from "../public/school-data.js";
import { createRequestGate } from "../public/request-gate.js";
import { parseCsv, schoolLocationDownload, schoolRecord } from "./school-data-lib.mjs";

test("school location CSV preserves quoted commas and coordinates", () => {
  const [row] = parseCsv("학교ID,학교명,학교급구분,설립형태,운영상태,소재지도로명주소,위도,경도,데이터기준일자\r\nB1,테스트중학교,중학교,공립,운영,\"서울시 강남구 길 1, 별관\",37.5,127.1,2026-03-20\r\n");
  assert.equal(row[5], "서울시 강남구 길 1, 별관");
  assert.deepEqual(schoolRecord(row, ["학교ID", "학교명", "학교급구분", "설립형태", "운영상태", "소재지도로명주소", "위도", "경도", "데이터기준일자"]), {
    id: "B1", name: "테스트중학교", level: "middle", ownership: "공립", address: "서울시 강남구 길 1, 별관",
    lat: 37.5, lng: 127.1, dataDate: "2026-03-20"
  });
});

test("school download parser does not borrow a file from an adjacent notice", () => {
  const html = `<tr onclick="fn_view_detail(event, '10')"><td>학교 경계 PDF</td><button data-atchfileid="PDF" data-filesn="0"></button></tr>
    <tr onclick="fn_view_detail(event, '20')"><td>초중고 학교 위치</td><button data-atchfileid="ZIP" data-filesn="1"></button></tr>`;
  assert.deepEqual(schoolLocationDownload(html), { nttId: "20", fileId: "ZIP", fileSn: "1" });
});

test("apartments receive the nearest three operating schools per level", () => {
  const schools = [
    ...[1, 2, 3, 4].map(index => ({ id: `e${index}`, name: `초${index}`, level: "elementary", lat: 37.5 + index / 1000, lng: 127 })),
    ...[1, 2, 3].map(index => ({ id: `m${index}`, name: `중${index}`, level: "middle", lat: 37.5, lng: 127 + index / 1000 })),
    ...[1, 2, 3].map(index => ({ id: `h${index}`, name: `고${index}`, level: "high", lat: 37.5 - index / 1000, lng: 127 }))
  ];
  const nearest = nearestSchools(schools, { lat: 37.5, lng: 127 });
  assert.deepEqual(nearest.elementary.map(item => item.id), ["e1", "e2", "e3"]);
  assert.deepEqual(nearest.middle.map(item => item.id), ["m1", "m2", "m3"]);
  assert.deepEqual(nearest.high.map(item => item.id), ["h1", "h2", "h3"]);
  assert.ok(nearest.elementary.every((item, index, items) => !index || item.distanceKm >= items[index - 1].distanceKm));
});

test("only the latest delayed detail request may update the UI", async () => {
  const gate = createRequestGate();
  let resolveFirst;
  let resolveSecond;
  const firstDelay = new Promise(resolve => { resolveFirst = resolve; });
  const secondDelay = new Promise(resolve => { resolveSecond = resolve; });
  let rendered = "";
  const open = async (name, delay) => {
    const request = gate.begin();
    await delay;
    if (gate.isCurrent(request)) rendered = name;
  };
  const first = open("first", firstDelay);
  const second = open("second", secondDelay);
  resolveSecond();
  await second;
  resolveFirst();
  await first;
  assert.equal(rendered, "second");

  const cancelled = open("cancelled", Promise.resolve());
  gate.cancel();
  await cancelled;
  assert.equal(rendered, "second");
});
