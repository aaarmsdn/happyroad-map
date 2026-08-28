function rows(text) {
  text = text.replace(/^\uFEFF/, "");
  const output = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some(cell => cell !== "")) output.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value);
    output.push(row);
  }
  return output;
}

export function csvHeaders(text) {
  return rows(text)[0] || [];
}

export function parseCsv(text) {
  return rows(text).slice(1);
}

export function schoolLocationDownload(html) {
  const row = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(match => match[0])
    .find(value => value.includes("초중고 학교 위치"));
  if (!row) return null;
  const nttId = row.match(/fn_view_detail\(event, '([^']+)'\)/)?.[1];
  const fileId = row.match(/data-atchfileid="([^"]+)"/i)?.[1];
  const fileSn = row.match(/data-filesn="([^"]+)"/i)?.[1];
  return nttId && fileId && fileSn !== undefined ? { nttId, fileId, fileSn } : null;
}

export function schoolRecord(row, headers) {
  const value = name => row[headers.indexOf(name)] || "";
  const levels = { "초등학교": "elementary", "중학교": "middle", "고등학교": "high" };
  const level = levels[value("학교급구분")];
  const lat = Number(value("위도"));
  const lng = Number(value("경도"));
  if (!level || value("운영상태") !== "운영" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: value("학교ID"),
    name: value("학교명"),
    level,
    ownership: value("설립형태"),
    address: value("소재지도로명주소") || value("소재지지번주소"),
    lat,
    lng,
    dataDate: value("데이터기준일자")
  };
}
