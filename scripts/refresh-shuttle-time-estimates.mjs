import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const apiBase = process.env.ROUTING_API_BASE || "https://happyroad-routing.aaarmsdn-happyroad.workers.dev";
const origin = process.env.ROUTING_ORIGIN || "https://aaarmsdn.github.io";
const estimateToken = process.env.SHUTTLE_ESTIMATE_TOKEN;
const inputUrl = new URL(process.env.SHUTTLE_DATA_URL || "../public/data/shuttle-data.js", import.meta.url);
const outputUrl = new URL(process.env.SHUTTLE_ESTIMATE_OUTPUT_URL || "../public/data/shuttle-time-estimates.js", import.meta.url);

const context = { window: {} };
vm.runInNewContext(await readFile(inputUrl, "utf8"), context);
const shuttle = context.window.HAPPYROAD_MAP_DATA;
if (!Array.isArray(shuttle?.entries)) throw new Error("셔틀 데이터를 읽지 못했습니다.");

const availableMinutes = value => value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
const missingMinutes = value => value === null || value === "" || value === undefined;
const clockMinutes = value => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const clockText = value => `${String(Math.floor((value % 1440) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const entryKey = entry => `${entry.turnUid}:${entry.stopOrder}:${entry.stationUid}`;

function futureStamp(minutes) {
  const date = new Date(Date.now() + 36 * 60 * 60 * 1000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMinutes(minutes);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0")).join("");
}

async function drivingMinutes(start, end, departureMinutes) {
  if (!estimateToken) throw new Error("SHUTTLE_ESTIMATE_TOKEN이 필요합니다.");
  const response = await fetch(`${apiBase}/route`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-happyroad-estimate-token": estimateToken },
    body: JSON.stringify({ start, end, mode: "car", departureTime: futureStamp(departureMinutes) })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Number.isFinite(payload?.minutes) || payload.minutes <= 0 || payload.minutes > 300) {
    throw new Error(`Kakao 경로 추정 실패: ${response.status} ${payload?.error || "invalid_duration"}`);
  }
  return Math.round(payload.minutes);
}

const turns = new Map();
const referenceMinutes = new Map();
for (const entry of shuttle.entries) {
  if (!turns.has(entry.turnUid)) turns.set(entry.turnUid, []);
  turns.get(entry.turnUid).push(entry);
  const field = entry.direction === "출근" ? "minutesToCompany" : entry.direction === "퇴근" ? "minutesFromCompany" : null;
  if (field && availableMinutes(entry[field])) {
    const key = `${entry.routeUid}:${entry.stationUid}:${entry.direction}`;
    if (!referenceMinutes.has(key)) referenceMinutes.set(key, []);
    referenceMinutes.get(key).push(Number(entry[field]));
  }
}
const pendingTurns = [...turns.values()].filter(entries => entries.some(entry => {
  const field = entry.direction === "출근" ? "minutesToCompany" : entry.direction === "퇴근" ? "minutesFromCompany" : null;
  return field && missingMinutes(entry[field]);
}));
const estimates = {};
for (const entry of shuttle.entries) {
  const field = entry.direction === "출근" ? "minutesToCompany" : entry.direction === "퇴근" ? "minutesFromCompany" : null;
  if (!field || !missingMinutes(entry[field])) continue;
  const samples = referenceMinutes.get(`${entry.routeUid}:${entry.stationUid}:${entry.direction}`)?.slice().sort((left, right) => left - right);
  if (!samples?.length) continue;
  const commuteMinutes = Math.round(samples[Math.floor(samples.length / 2)]);
  const company = clockMinutes(entry.companyTime);
  if (company === null) continue;
  const estimatedTime = entry.direction === "출근" ? company - commuteMinutes : company + commuteMinutes;
  estimates[entryKey(entry)] = {
    time: clockText(estimatedTime + 1440),
    [field]: commuteMinutes,
    displayMinutes: commuteMinutes,
    sourceTimeText: "동일 노선·정류장 다른 운행시간 중앙값으로 추정",
    timeEstimated: true
  };
}
const siblingEstimateCount = Object.keys(estimates).length;
let nextTurn = 0;

async function estimateTurn() {
  while (nextTurn < pendingTurns.length) {
    const entries = pendingTurns[nextTurn++].slice().sort((left, right) => left.stopOrder - right.stopOrder);
    let previous = null;
    let previousTime = null;
    for (const entry of entries) {
      const field = entry.direction === "출근" ? "minutesToCompany" : entry.direction === "퇴근" ? "minutesFromCompany" : null;
      const preset = estimates[entryKey(entry)];
      const knownTime = clockMinutes(preset?.time || entry.time);
      if (knownTime !== null && (!field || preset || availableMinutes(entry[field]) || entry.isCompany)) {
        let absolute = knownTime;
        while (previousTime !== null && absolute < previousTime) absolute += 1440;
        previous = entry;
        previousTime = absolute;
        continue;
      }
      if (!field || preset || !missingMinutes(entry[field]) || !previous || previousTime === null) continue;
      let segmentMinutes;
      try {
        segmentMinutes = await drivingMinutes(
          { lat: previous.lat, lng: previous.lng },
          { lat: entry.lat, lng: entry.lng },
          previousTime
        );
      } catch (error) {
        throw new Error(`${entry.routeName} ${previous.station} -> ${entry.station}: ${error.message}`);
      }
      const estimatedTime = previousTime + segmentMinutes;
      const company = clockMinutes(entry.companyTime);
      if (company === null) throw new Error(`${entry.routeName} 회사 시간이 없습니다.`);
      const commuteMinutes = entry.direction === "출근"
        ? (company - estimatedTime % 1440 + 1440) % 1440
        : (estimatedTime % 1440 - company + 1440) % 1440;
      if (commuteMinutes <= 0 || commuteMinutes > 300) throw new Error(`${entry.routeName} ${entry.station} 추정 시간이 비정상입니다.`);
      estimates[entryKey(entry)] = {
        time: clockText(estimatedTime),
        [field]: commuteMinutes,
        displayMinutes: commuteMinutes,
        sourceTimeText: "직전 정류장부터 Kakao 예상 주행시간으로 추정",
        timeEstimated: true
      };
      previous = entry;
      previousTime = estimatedTime;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(8, pendingTurns.length) }, estimateTurn));
const expected = shuttle.entries.filter(entry => {
  const field = entry.direction === "출근" ? "minutesToCompany" : entry.direction === "퇴근" ? "minutesFromCompany" : null;
  return field && missingMinutes(entry[field]);
}).length;
if (Object.keys(estimates).length !== expected) throw new Error(`누락 ${expected}건 중 ${Object.keys(estimates).length}건만 추정했습니다.`);

const payload = {
  generatedAt: new Date().toISOString(),
  source: "동일 노선 운행시간 + Kakao Mobility 미래 자동차 길찾기",
  count: expected,
  methods: { siblingSchedule: siblingEstimateCount, kakaoDriving: expected - siblingEstimateCount },
  estimates
};
const source = `window.HAPPYROAD_SHUTTLE_TIME_ESTIMATES=${JSON.stringify(payload)};\n` +
  `for(const entry of window.HAPPYROAD_MAP_DATA?.entries||[]){const estimate=window.HAPPYROAD_SHUTTLE_TIME_ESTIMATES.estimates[\`${"${entry.turnUid}:${entry.stopOrder}:${entry.stationUid}"}\`],field=entry.direction==="출근"?"minutesToCompany":entry.direction==="퇴근"?"minutesFromCompany":null;if(estimate&&field&&(entry[field]===null||entry[field]===""||entry[field]===undefined)){entry[field]=estimate[field];if(entry.displayMinutes===null||entry.displayMinutes===""||entry.displayMinutes===undefined)entry.displayMinutes=estimate.displayMinutes;if(entry.time===null||entry.time===""||entry.time===undefined){entry.time=estimate.time;entry.timeEstimated=true}if(!entry.sourceTimeText)entry.sourceTimeText=estimate.sourceTimeText}}\n`;
await writeFile(outputUrl, source, "utf8");
console.log(`셔틀 누락시간 ${expected}건 추정 완료`);
