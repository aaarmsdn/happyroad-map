# 전국 통합 출퇴근 길찾기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선택 위치와 회사 사이의 셔틀·전국 대중교통·도보 통합 경로를 출발 시각 기준으로 제공한다.

**Architecture:** 브라우저가 셔틀 시간표로 후보를 선별하고 Cloudflare Worker가 Kakao REST API를 보호된 키로 호출한다. 기존 Leaflet 지도와 정적 PWA 구조를 유지한다.

**Tech Stack:** Vanilla JavaScript ES modules, Leaflet, Node test runner, Cloudflare Workers, Kakao Maps REST API

**Spec:** `docs/superpowers/specs/2026-08-26-commute-routing-design.md`

## Global Constraints

- 대한민국 좌표 범위를 지원한다.
- 현재 위치 권한 없이 지도 또는 검색으로 위치를 선택한다.
- 출발 날짜와 시각을 사용자가 지정한다.
- 새 런타임 의존성을 추가하지 않는다.
- API 키를 저장소와 브라우저 번들에 넣지 않는다.

---

### Task 1: 지도 선택 상태

**Files:** `public/app-main.js`, `public/app-events.js`, `public/map-view.js`, `scripts/map-view.test.mjs`, `scripts/ui-contract.test.mjs`

**Interfaces:** `clearRoute()`, `stopDirectionState(stop)`, `addStopMarkers({ dimIncompleteDirections })`

- [ ] 지도 배경 탭과 마커 탭을 구분하는 실패 테스트를 추가한다.
- [ ] 드래그·줌은 노선을 지우지 않는 계약 테스트를 추가한다.
- [ ] 출근·퇴근 한 방향 정류장의 흐림 상태 테스트를 추가한다.
- [ ] `map.on("click")`에서 배경 탭만 `clearRoute()`와 `closeDetail()`을 호출한다.
- [ ] 정류장 아이콘에 방향 완전성 CSS 변수를 적용한다.
- [ ] 관련 Node 테스트를 실행한다.

### Task 2: 셔틀 경로 계산기

**Files:** `public/commute-routing.js`, `scripts/commute-routing.test.mjs`, `package.json`

**Interfaces:** `findShuttleCandidates({ entries, mode, point, departureAt, limit })`, `combineJourney({ shuttle, accessRoute })`

- [ ] 선택 위치, 출발 시각, 방향별 후보를 검증하는 실패 테스트를 추가한다.
- [ ] `stopOrder`와 정류장 시각을 이용해 가능한 다음 셔틀을 최대 5개 반환한다.
- [ ] 대중교통 구간 소요시간과 셔틀 시각을 결합해 총 시간을 계산한다.
- [ ] 자정을 넘는 시각과 지난 셔틀을 처리한다.
- [ ] 전체 Node 테스트를 실행한다.

### Task 3: 길찾기 사용자 화면

**Files:** `public/index.html`, `public/styles.css`, `public/app-main.js`, `public/app-events.js`, `public/commute-view.js`, `public/sw.js`, `scripts/ui-contract.test.mjs`

**Interfaces:** `openCommutePlanner()`, `selectCommutePoint(latlng)`, `renderCommuteResults(journeys)`

- [ ] 길찾기 버튼, 출근·퇴근 모드, 출발 일시, 위치 선택 버튼의 UI 계약 테스트를 추가한다.
- [ ] 지도 탭으로 선택 위치 마커를 표시한다.
- [ ] 출발 시각 기본값을 현재 시각의 다음 5분으로 설정한다.
- [ ] 후보 결과를 총 시간순으로 표시하고 선택 시 셔틀 경로를 강조한다.
- [ ] 작은 화면에서 패널이 안전 영역 안에서 스크롤되는지 확인한다.

### Task 4: Kakao API 프록시

**Files:** `worker/src/index.js`, `worker/wrangler.jsonc`, `worker/README.md`, `scripts/worker.test.mjs`, `package.json`

**Interfaces:** `GET /places?q=...`, `POST /route` with `{ start, end, mode }`

- [ ] 허용 origin, 좌표 범위, 요청 방식을 검증하는 실패 테스트를 추가한다.
- [ ] `KAKAO_REST_API_KEY` secret으로 장소, 대중교통, 도보 API를 호출한다.
- [ ] 앱에 필요한 응답 필드만 정규화한다.
- [ ] API 오류와 쿼터 초과를 안정된 JSON 오류로 변환한다.
- [ ] Worker 단위 테스트와 앱 전체 테스트를 실행한다.

### Task 5: 실제 사용 검증

**Files:** 변경 없음

**Interfaces:** 로컬 정적 서버와 브라우저 UI

- [ ] 데스크톱과 작은 모바일 화면에서 지도 배경 탭 해제를 확인한다.
- [ ] 드래그와 줌 뒤 노선 유지를 확인한다.
- [ ] 한 방향 정류장 흐림을 확인한다.
- [ ] 선택 위치와 출발 시각을 바꿔 출근·퇴근 후보 결과를 확인한다.
- [ ] API 미설정 상태의 오류 안내를 확인한다.
