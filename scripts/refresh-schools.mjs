import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvHeaders, parseCsv, schoolRecord } from "./school-data-lib.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv.includes("--help")) {
  console.log(`Usage: npm run schools:refresh -- <school-location.csv>\n\nThe location CSV is the official Schoolzone nationwide school file.`);
  process.exit(0);
}

const inputPath = process.argv[2] || process.env.SCHOOL_LOCATION_CSV;
if (!inputPath) throw new Error("School location CSV path is required. Run with --help for setup.");

const bytes = await readFile(path.resolve(inputPath));
const text = new TextDecoder().decode(bytes);
const headers = csvHeaders(text);
const requiredHeaders = ["학교ID", "학교명", "학교급구분", "운영상태", "소재지도로명주소", "위도", "경도", "데이터기준일자"];
if (requiredHeaders.some(header => !headers.includes(header))) throw new Error("School location CSV schema is not supported.");

const schools = parseCsv(text).map(row => schoolRecord(row, headers)).filter(Boolean);
if (schools.length < 10000) throw new Error(`School location CSV returned only ${schools.length} operating schools.`);

const dataDates = schools.map(school => school.dataDate).filter(Boolean).sort();
const output = {
  generatedAt: new Date().toISOString(),
  source: {
    name: "한국교육시설안전원 초중고 학교 위치",
    url: "https://schoolzone.emac.kr/publicData/publicDataList.do",
    dataDate: dataDates.at(-1) || null,
    proximity: "직선거리",
    metrics: {
      name: "학교알리미",
      url: "https://www.schoolinfo.go.kr/",
      status: "not_connected",
      checkedAt: "2026-08-28"
    }
  },
  schools
};
await writeFile(path.join(projectDir, "public", "data", "schools.json"), JSON.stringify(output));
console.log(JSON.stringify({ schools: schools.length, dataDate: output.source.dataDate }, null, 2));
