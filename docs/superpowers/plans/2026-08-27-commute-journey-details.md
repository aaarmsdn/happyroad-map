# 출퇴근 추천 경로 상세 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보·택시·대중교통 추천을 비교 가능한 시간 분해와 실제 안내 단계로 제공하고 지도에는 이용 구간만 정확히 표시한다.

**Architecture:** Cloudflare Worker가 Kakao 응답에서 앱에 필요한 단계와 좌표만 정규화한다. 브라우저는 이 응답을 셔틀 시간표와 결합해 대기·셔틀·접근 시간을 계산하고, 기존 Leaflet 레이어에 접근 구간과 잘라낸 셔틀 구간을 그린다.

**Tech Stack:** Vanilla JavaScript ES modules, Leaflet, Node test runner, Cloudflare Workers, Kakao REST API

**Spec:** `docs/superpowers/specs/2026-08-26-commute-routing-design.md`, `DESIGN.md`

## Global Constraints

- 추천 순서는 도보 1개, 택시 1개, 대중교통 3개다.
- API 키와 원본 Kakao 응답은 브라우저에 노출하지 않는다.
- 새 런타임 의존성을 추가하지 않는다.
- 기존 지도 뷰와 셔틀 데이터 좌표를 유지한다.
- 현재 위치 권한 성공 시 해당 좌표를 길찾기 선택 위치로 사용한다.

---

### Task 1: Worker 경로 정규화

**Files:** `scripts/worker.test.mjs`, `worker/src/index.js`

**Interfaces:** `POST /route` returns `{ minutes, transfers, fare, distanceMeters, points, steps }`.

- [ ] 대중교통·도보·자동차 응답의 단계와 좌표를 검증하는 실패 테스트를 작성한다.
- [ ] 각 Kakao 응답에서 문자열, 단계 수, 좌표 수를 제한해 정규화한다.
- [ ] 자동차 요청은 상세 도로 좌표를 받도록 `summary=false`를 사용한다.
- [ ] Worker 테스트를 실행해 통과를 확인한다.

### Task 2: 추천 시간 분해

**Files:** `scripts/commute-routing.test.mjs`, `public/commute-routing.js`

**Interfaces:** `recommendCommuteJourneys()` returns `waitMinutes`, `shuttleMinutes`, `accessMinutes`, `accessRoute`.

- [ ] 도보→택시→대중교통 순서와 출근·퇴근 시간 분해 실패 테스트를 작성한다.
- [ ] 셔틀 대기와 탑승 시간을 시간표에서 계산한다.
- [ ] Worker의 좌표·안내 단계를 추천 결과에 유지한다.
- [ ] 추천 계산 테스트를 실행해 통과를 확인한다.

### Task 3: 이용 구간 지도 표시

**Files:** `scripts/map-view.test.mjs`, `public/map-view.js`, `public/app-main.js`

**Interfaces:** `routeSegmentPoints()`, `addJourneyPaths()`.

- [ ] 승하차 좌표로 셔틀 폴리라인을 자르는 실패 테스트를 작성한다.
- [ ] 접근 경로와 셔틀 이용 구간을 서로 다른 색으로 렌더링한다.
- [ ] 목적지 마커를 확대하고 경로 상세 선택 시 해당 추천만 그린다.
- [ ] 지도 단위 테스트를 실행해 통과를 확인한다.

### Task 4: 추천 카드와 상세 단계

**Files:** `scripts/ui-contract.test.mjs`, `public/app-main.js`, `public/styles.css`, `public/sw.js`

**Interfaces:** `renderCommuteResults()`, `renderCommuteJourneyDetail()`.

- [ ] 시간 분해와 상세 버튼 UI 계약 실패 테스트를 작성한다.
- [ ] 총합·대기·셔틀·접근 시간 요약 카드를 구현한다.
- [ ] 실제 접근 단계와 셔틀 승하차를 순서대로 표시하는 상세 화면을 구현한다.
- [ ] 모바일 안전 영역과 375px 폭의 텍스트 넘침을 확인한다.

### Task 5: 아파트 정류장 출퇴근 시간

**Files:** `scripts/ui-contract.test.mjs`, `public/detail-view.js`, `public/app-main.js`

**Interfaces:** `apartmentStopTimings(entries)` and `apartmentDetailHtml({ relatedLinks })` timing fields.

- [ ] 통상 운행 우선 및 08:00/18:00 대체 기준 실패 테스트를 작성한다.
- [ ] 정류장별 출근·퇴근 소요시간과 대체 기준을 계산한다.
- [ ] 각 정류장에 출근·퇴근·도보 값을 표시한다.
- [ ] 상세 화면 테스트를 실행해 통과를 확인한다.

### Task 6: 배포와 실제 사용 검증

**Files:** `worker/src/index.js`, `public/*`, `worker/wrangler.jsonc`

**Interfaces:** 로컬 브라우저와 배포된 Worker.

- [ ] 전체 테스트와 데이터 검사를 실행한다.
- [ ] 375px, 768px, 1280px 실제 브라우저에서 출근·퇴근 검색과 상세 경로를 확인한다.
- [ ] Cloudflare Worker를 재배포하고 허용 origin에서 실제 장소·경로 응답을 확인한다.
- [ ] 최종 코드·보안·QA 리뷰와 3개 런타임 가설 감사를 통과한다.

### Task 7: 현재 위치 선택

**Files:** `scripts/ui-contract.test.mjs`, `public/index.html`, `public/app-main.js`, `public/styles.css`

**Interfaces:** `useCurrentLocationForCommute()`.

- [ ] 현재 위치 버튼과 geolocation 연결 계약의 실패 테스트를 작성한다.
- [ ] 권한 성공 좌표를 큰 선택 마커와 위치 라벨에 반영한다.
- [ ] 권한 미지원·거부 오류를 토스트로 표시한다.
- [ ] 모바일 실제 브라우저에서 모의 위치로 선택 상태를 확인한다.
