import { readFile, readdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const seconds = value => {
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(value || "")) return null;
  const [h, m, s = 0] = value.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};
const clock = value => value === null ? "" : new Date(Math.round(value) * 1000).toISOString().slice(11, 19);
const minutes = value => value === null ? null : Math.floor(value / 60);

export function applyServiceWeekdays(shuttle, details) {
  const codes = ["WKD-SUN", "WKD-MON", "WKD-TUE", "WKD-WED", "WKD-THU", "WKD-FRI", "WKD-SAT"];
  for (const entry of shuttle.entries) {
    const turn = details.get(entry.turnUid);
    // ponytail: weekly calendar only; WKD-HOLI needs a separate dated holiday calendar.
    const days = (turn?.earlyDriveWeekly || []).filter(day => day.weekdayCode !== "WKD-HOLI").map(day => {
      const index = codes.indexOf(day.weekdayCode);
      if (index < 0) throw new Error(`Unknown service weekday: ${day.weekdayCode}`);
      return index;
    });
    entry.serviceWeekdays = turn?.useYn === false ? [] : [...new Set(days)].sort();
  }
}

export function applyMonthly(shuttle, averages, schedules, details, period) {
  for (const row of averages) {
    if (!row.routeUid || !row.turnUid || !row.stationUid || !Number.isInteger(row.sampleDays) || row.sampleDays < 0 || row.sampleDays > 31
      || (row.sampleDays > 0 && (!Number.isFinite(row.meanServiceSeconds) || row.meanServiceSeconds < 0 || row.meanServiceSeconds > 172800))) {
      throw new Error("Invalid monthly observation");
    }
  }
  const means = Map.groupBy(averages.filter(row => row.busOrder === 1), row => `${row.routeUid}:${row.turnUid}:${row.stationUid}`);
  const styles = new Map(shuttle.entries.map(entry => [entry.durationBucket, { color: entry.color, durationGroup: entry.durationGroup }]));
  const report = { turns: 0, monthly: 0, scheduled: 0, missing: 0, companyEndpointAliases: 0, invalidDurations: 0 };
  for (const entries of Map.groupBy(shuttle.entries, entry => entry.turnUid).values()) {
    entries.sort((a, b) => a.stopOrder - b.stopOrder);
    const first = entries[0];
    if (!["출근", "퇴근"].includes(first.direction)) continue;
    report.turns++;
    const inbound = first.direction === "출근";
    const schedule = schedules.get(first.turnUid);
    const detail = details.get(first.turnUid);
    const start = seconds(schedule?.beginStationDepartureTime);
    const company = entries.find(entry => entry.isCompany);
    const values = new Map();
    for (const entry of entries) {
      let stationUid = entry.stationUid;
      let matches = means.get(`${entry.routeUid}:${entry.turnUid}:${stationUid}`) || [];
      // Older exports used a synthetic campus endpoint for internal drop-offs.
      if (!matches.length && inbound && entry.isCompany && detail?.endStation?.internalYn) {
        stationUid = detail.endStation.uid;
        matches = means.get(`${entry.routeUid}:${entry.turnUid}:${stationUid}`) || [];
        if (matches.length === 1) report.companyEndpointAliases++;
      }
      const mean = matches.length === 1 ? matches[0] : null;
      const scheduled = schedule && start !== null && (inbound
        ? entry.stationUid === schedule.stations[0]?.uid
        : entry === company);
      const value = scheduled ? start : mean?.sampleDays > 0 ? mean.meanServiceSeconds : null;
      values.set(entry, value);
      entry.time = clock(value);
      entry.timeBasis = scheduled ? "scheduled" : value === null ? "missing" : "monthly-average";
      entry.sampleDays = mean?.sampleDays || 0;
      entry.arrivalSourceStationUid = stationUid;
      entry.sourceTimeText = scheduled ? "시간표 정시출발" : value === null ? "한 달 실측 기록 없음" : "직전 한 달 실측 평균";
      delete entry.timeEstimated;
      delete entry.originalTime;
      delete entry.originalMinutesFromCompany;
      report[scheduled ? "scheduled" : value === null ? "missing" : "monthly"]++;
    }
    const companySeconds = values.get(company) ?? null;
    const finalSeconds = values.get(entries.at(-1));
    for (const entry of entries) {
      const value = values.get(entry);
      const delta = value === null || companySeconds === null ? null : (inbound ? companySeconds - value : value - companySeconds);
      // Service-day seconds already include midnight rollover; negative is not a next-day trip.
      const duration = delta !== null && delta >= 0 && delta <= 5 * 3600 ? Math.ceil(delta / 60) : null;
      if (delta !== null && duration === null) report.invalidDurations++;
      entry.minutesToCompany = inbound ? duration : null;
      entry.minutesFromCompany = inbound ? null : duration;
      entry.displayMinutes = duration;
      entry.companyTime = clock(companySeconds);
      entry.scheduledCompanyDepartureTime = inbound ? "" : clock(start);
      entry.scheduledCompanyArrivalTime = inbound ? schedule?.endStationArrivalTime || "" : "";
      entry.turnStartTime = clock(start);
      entry.turnStartMinutes = minutes(start);
      entry.turnFinalArrivalTime = clock(finalSeconds);
      entry.turnFinalArrivalMinutes = minutes(finalSeconds);
      entry.durationBucket = duration === null ? "unknown" : duration < 30 ? "0-30" : duration < 120 ? `${Math.floor(duration / 15) * 15}-${Math.floor(duration / 15) * 15 + 15}` : "120+";
      Object.assign(entry, styles.get(entry.durationBucket));
    }
  }
  const firstByTurn = new Map(shuttle.entries.map(entry => [entry.turnUid, entry]));
  for (const path of shuttle.paths) {
    const entry = firstByTurn.get(path.turnUid);
    for (const key of ["turnStartTime", "turnStartMinutes", "turnFinalArrivalTime", "turnFinalArrivalMinutes"]) path[key] = entry[key];
  }
  shuttle.source.monthly = { ...period, busOrder: 1, scope: "existing-commute-routes", method: "mean-pastArrivalDtm", report };
  return report;
}

async function main() {
  const source = process.argv[2];
  if (!source || source === "--help") {
    console.log("Usage: node scripts/import-shuttle-monthly.mjs <raw-source-directory>");
    if (!source) process.exitCode = 1;
    return;
  }
  const root = resolve(source);
  const readJson = async file => JSON.parse(await readFile(`${root}/${file}`, "utf8"));
  const [manifest, averages, files, routeFiles, text] = await Promise.all([
    readJson("manifest.json"), readJson("monthly-averages.json"), readdir(`${root}/route-lists`), readdir(`${root}/routes`),
    readFile(new URL("../public/data/shuttle-data.js", import.meta.url), "utf8")
  ]);
  const context = { window: {} };
  vm.runInNewContext(text, context);
  const lists = await Promise.all(files.sort().map(async file => JSON.parse(gunzipSync(await readFile(`${root}/route-lists/${file}`)))));
  lists.push(await readJson("routes-2026-09-16.json"));
  const schedules = new Map(lists.flatMap(list => list.data.flatMap(route => route.turns.map(turn => [turn.uid, turn]))));
  const routes = await Promise.all(routeFiles.map(async file => JSON.parse(gunzipSync(await readFile(`${root}/routes/${file}`)))));
  const details = new Map(routes.flatMap(route => route.data.turns.map(turn => [turn.uid, turn])));
  const shuttle = context.window.HAPPYROAD_MAP_DATA;
  applyServiceWeekdays(shuttle, details);
  const report = applyMonthly(shuttle, averages, schedules, details, { from: manifest.periodStart, through: manifest.periodEnd });
  shuttle.generatedAt = new Date().toISOString();
  await writeFile(new URL("../public/data/shuttle-data.js", import.meta.url), `window.HAPPYROAD_MAP_DATA=${JSON.stringify(shuttle)};\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
