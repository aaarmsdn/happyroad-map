# 길찾기 API Worker

Kakao REST API 키를 GitHub Pages에 노출하지 않는 프록시입니다.

카카오디벨로퍼스의 `앱 > 플랫폼 키 > REST API 키` 값을 사용합니다. JavaScript 키와 JavaScript SDK 도메인은 사용하지 않습니다. 카카오맵의 장소 검색·대중교통·도보 경로와 Kakao Mobility 자동차 길찾기가 같은 REST API 키로 호출됩니다.

```bash
cd worker
npx wrangler login
npx wrangler secret put KAKAO_REST_API_KEY
npx wrangler secret put SHUTTLE_ESTIMATE_TOKEN
npx wrangler deploy
```

`SHUTTLE_ESTIMATE_TOKEN`에는 충분히 긴 임의 문자열을 사용합니다. 정류장 도착시간 추정 데이터를 다시 만들 때 같은 값을 로컬 환경 변수로 전달합니다.

```bash
SHUTTLE_ESTIMATE_TOKEN="..." node ../scripts/refresh-shuttle-time-estimates.mjs
```

배포 후 `public/index.html`의 `commute-api-base` meta `content`에 출력된 `https://...workers.dev` 주소를 넣습니다. 로컬 테스트도 허용하려면 `wrangler.jsonc`의 `ALLOWED_ORIGIN`에 쉼표로 `http://127.0.0.1:8765`를 추가합니다. 키는 파일이나 GitHub secret에 평문으로 넣지 않습니다.

장소 검색어와 좌표는 경로 계산을 위해 Kakao API에 전달됩니다. Worker와 브라우저 응답은 `no-store`로 반환하며 앱에는 저장하지 않습니다.
