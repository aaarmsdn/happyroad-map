# 하이로드 웹앱

이동 경로의 정류장과 주변 아파트를 한 지도에서 비교하는 정적 PWA입니다. 경로 원본 데이터는 그대로 유지하고, 아파트와 가격 데이터는 별도 JSON으로 관리합니다.

## 비용과 운영

- 개인 PC 서버: 필요 없음
- 웹 호스팅: 공개 저장소의 GitHub Pages 사용
- 정기 실행: GitHub Actions 주 1회 사용
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
3. `.github/workflows/refresh-prices.yml`이 최근 12개월 거래를 매주 화요일 04:17(KST)에 갱신하고 변경 파일을 커밋합니다.

`config/sgg.json`의 시군구 경계로 각 아파트 좌표의 5자리 `LAWD_CD`를 계산합니다. 국토부 거래와 단지 좌표의 지역 코드가 같고 정규화한 이름이 하나로 일치할 때 갱신합니다. 동 이름이 붙거나 `차` 표기가 다른 경우에는 시군구·준공연도·전용면적 구간·단지명 꼬리가 모두 일치하는 유일한 후보만 자동 연결합니다. 명시적인 예외는 `config/price-name-aliases.json`에 등록하며, 후보가 둘 이상이면 잘못 연결하지 않고 건너뜁니다. 네이버는 현재 매물을 확인하는 외부 링크만 제공하며, 호가·매물 스냅샷을 저장하거나 비공식 API를 호출하지 않습니다.

저장소에는 기존 국토부 공개자료 스냅샷을 초기 가격으로 포함합니다. `MOLIT_API_KEY`를 등록하고 워크플로를 실행하면 검증된 단지부터 최신 거래로 교체됩니다.

## GitHub Pages 배포

저장소 `Settings > Pages > Build and deployment > Source`에서 `GitHub Actions`를 선택합니다. `main`에 앱이나 갱신 가격이 푸시되면 `.github/workflows/deploy-pages.yml`이 `public` 폴더를 자동 배포합니다. 배포용 API 키는 필요 없습니다.

## 데이터 갱신 규칙

- `npm run prices:refresh`: 최근 3개월 국토부 실거래를 단지명으로 보수적으로 매칭
- `npm run prices:import-snapshot -- <원본 경로>`: 해시로 고정한 초기 국토부 스냅샷 재생성
- `npm run check`: 아파트, 가격, 정류장 연결 무결성 검사

저장소에 포함된 데이터별 출처와 공개 시 확인 사항은 [`DATA_SOURCES.md`](./DATA_SOURCES.md)에 정리했습니다.

## 행정구역 경계 출처

`config/sgg.json`은 통계청 SGIS·행정안전부 자료를 가공한 [mapcn-kr](https://github.com/DevMinGeonPark/mapcn-kr)의 2026-07 시군구 경계입니다. 데이터는 CC BY 4.0이며 자세한 출처와 리비전은 `config/LICENSE-sgg-data`에 기록했습니다.
