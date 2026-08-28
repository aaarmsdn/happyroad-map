import { writeFile } from "node:fs/promises";
import { schoolLocationDownload } from "./school-data-lib.mjs";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Output ZIP path is required.");
const listUrl = "https://schoolzone.emac.kr/publicData/publicDataList.do";
const html = await fetch(listUrl, { signal: AbortSignal.timeout(30000) }).then(response => {
  if (!response.ok) throw new Error(`Schoolzone list: HTTP ${response.status}`);
  return response.text();
});
const parts = schoolLocationDownload(html);
if (!parts) throw new Error("Latest Schoolzone location file was not found.");
const url = new URL("/publicData/publicDataFileDownload.do", listUrl);
url.searchParams.set("nttId", parts.nttId);
url.searchParams.set("atchFileId", parts.fileId);
url.searchParams.set("fileSn", parts.fileSn);
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Schoolzone download: HTTP ${response.status}`);
const maxBytes = 30 * 1024 * 1024;
const declaredBytes = Number(response.headers.get("content-length"));
if (declaredBytes > maxBytes) throw new Error("Schoolzone download exceeds 30 MB.");
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.length > maxBytes) throw new Error("Schoolzone download exceeds 30 MB.");
if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(bytes[2]) || ![0x04, 0x06, 0x08].includes(bytes[3])) {
  throw new Error("Schoolzone download is not a ZIP archive.");
}
await writeFile(outputPath, bytes);
console.log(String(url));
