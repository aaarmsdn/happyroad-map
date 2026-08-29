# 하이로드 웹앱

이동 경로의 정류장과 주변 아파트를 한 지도에서 비교하는 정적 PWA입니다. 경로 원본 데이터는 그대로 유지하고, 아파트와 가격 데이터는 별도 JSON으로 관리합니다.

## 비용과 운영

- 개인 PC 서버: 필요 없음
- 웹 호스팅: 공개 저장소의 GitHub Pages 사용
- 정기 실행: GitHub Actions 매일 사용
- 가격 원본: 공공데이터포털 국토교통부 아파트 매매 실거래가 API
- 데이터베이스: 사용하지 않음. 큰 정적 JSON을 그대로 배포해 운영 구성을 줄임

공개 GitHub 저장소의 GitHub Pages와 일반 GitHub-hosted Actions를 사용하므로 개인 서버나 별도 유료 호스팅 계정이 필요 없습니다.

## 로컬 실행

```bash
npm run check
npm start
```

브라우저에서 `http://127.0.0.1:8765`를 엽니다.

## 무료 자동 가격 갱신

1. [공공데이터포털 국토교통부 아파트 매매 실거래가 상세 자료](https://www.data.go.kr/data/15126468/openapi.do?recommendDataYn=Y)에서 활용 신청 후 일반 인증키를 받습니다. Encoding/Decoding 키 모두 처리합니다.
2. GitHub 저장소 `Settings > Secrets and variables > Actions`에 `MOLIT_API_KEY`를 등록합니다.
3. `.github/workflows/refresh-prices.yml`이 최근 12개월 거래를 매일 04:17(KST)에 갱신하고 변경 파일을 커밋합니다.

`config/sgg.json`의 시군구 경계로 각 아파트 좌표의 5자리 `LAWD_CD`를 계산합니다. 국토부 거래와 단지 좌표의 지역 코드가 같고 정규화한 이름이 하나로 일치할 때 갱신합니다. 이름이 다르면 한국부동산원 공동주택 단지 식별정보의 법정동·지번을 우선 사용하고, 같은 필지를 여러 공식 단지가 공유하면 자동 연결하지 않습니다. 남은 단지는 보수적인 이름 포함 규칙이나 `config/price-name-aliases.json`의 검증된 별칭만 사용합니다. 네이버는 현재 매물을 확인하는 외부 링크만 제공하며, 호가·매물 스냅샷을 저장하거나 비공식 API를 호출하지 않습니다.

단지 매칭과 전체 평당가는 모든 전용면적 거래를 사용합니다. 59·84·102·115㎡ 가격표와 면적 필터는 해당 면적 범위의 거래만 별도로 집계합니다.

저장소에는 기존 국토부 공개자료 스냅샷을 초기 가격으로 포함합니다. `MOLIT_API_KEY`를 등록하고 워크플로를 실행하면 검증된 단지부터 최신 거래로 교체됩니다.

## GitHub Pages 배포

저장소 `Settings > Pages > Build and deployment > Source`에서 `GitHub Actions`를 선택합니다. `main`에 앱이나 갱신 가격이 푸시되면 `.github/workflows/deploy-pages.yml`이 `public` 폴더를 자동 배포합니다. 정적 지도 배포 자체에는 API 키가 필요 없습니다.

장소 검색과 택시·대중교통·도보 길찾기는 별도 Cloudflare Worker를 사용합니다. 카카오디벨로퍼스의 REST API 키를 `KAKAO_REST_API_KEY` Worker secret으로 등록하고 배포 주소를 `public/index.html`의 `commute-api-base`에 넣습니다. JavaScript 키나 SDK 도메인은 사용하지 않습니다. 명령과 보안 설정은 [`worker/README.md`](./worker/README.md)를 따릅니다.

## 데이터 갱신 규칙

- `npm run prices:refresh`: 워크플로 기준 최근 12개월 국토부 실거래를 공식 필지·검증 별칭·보수적 단지명 순서로 매칭
- `node scripts/refresh-apartment-identities.mjs <한국부동산원 CSV> --address-worker <Worker URL>`: 이름 미일치 단지를 좌표의 단일 공식 필지로 보완
- `npm run prices:import-snapshot -- <원본 경로>`: 해시로 고정한 초기 국토부 스냅샷 재생성
- `npm run check`: 아파트, 가격, 정류장 연결 무결성 검사

저장소에 포함된 데이터별 출처와 공개 시 확인 사항은 [`DATA_SOURCES.md`](./DATA_SOURCES.md)에 정리했습니다.

## 행정구역 경계 출처

`config/sgg.json`은 통계청 SGIS·행정안전부 자료를 가공한 [mapcn-kr](https://github.com/DevMinGeonPark/mapcn-kr)의 2026-07 시군구 경계입니다. 데이터는 CC BY 4.0이며 자세한 출처와 리비전은 `config/LICENSE-sgg-data`에 기록했습니다.
