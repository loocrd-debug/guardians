# 가디언즈 — 웹 품질 종합 검사 도구

웹 접근성(KWCAG 2.2) · KRDS 정부 디자인 기준 · 깨진 링크 · 오탈자 · HTML 표준 · 브라우저 호환 · 스크린 리더를 한 번에 검사하고 PPTX · Excel · HTML 결과서를 만듭니다. 설치형(행정망 포함) · 팀 웹 · 크롬 확장으로 같은 결과를 냅니다.

- 공식 사이트: https://guardians.ai.kr
- 다운로드(설치 파일 · ZIP · 확장): https://guardians.ai.kr/download.html · GitHub Releases

## 구성
| 경로 | 내용 |
|------|------|
| `server.cjs` | 검사 서버 (Node 22 · Express 5 · Playwright) |
| `ai.cjs` | AI 보조 (Claude API — 빈칸 채우기 · 요약 · 말로 지시) |
| `krds_*.cjs`, `krds_palette.json` | KRDS 구조 · 디자인 토큰 판정, **KRDS 기준 자동 추적(AI)**, **기준 버전 · 서명 · 배포** |
| `reader.cjs`, `offline.cjs`, `scheduler.cjs`, `suggest.js`, `pptx_node.js` | 스크린 리더 · 폐쇄망 엔진 · 예약 검사 · 수정 제안 · 결과서 |
| `public/` | 화면 · 사용설명서 |
| `extension/` | 크롬 확장 (MV3 · 사이드 패널) |
| `deploy/` | 서버 배포 (Docker · Caddy · 업데이트 스크립트) |
| `installer/` | Windows 설치 파일 (NSIS) — `build.sh` |

## 실행 (개발)
```
npm install
npx playwright install chromium
node server.cjs        # http://localhost:3000
```

## 비밀 정보
API 키 · 관리자 토큰 · 기준 서명 키는 **저장소에 넣지 않습니다.** 서버의 `docker-compose.yml` 환경 변수와 `data/`에만 둡니다.
