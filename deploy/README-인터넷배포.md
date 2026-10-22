# 가디언즈 인터넷 배포 안내 (v6.13)

설치형(EXE)과 같은 코드로 **웹 서비스**로 띄울 수 있습니다. 이용자는 설치 없이 주소만 열면 됩니다.

## 1. 준비물
| 항목 | 내용 |
|------|------|
| 서버 | Linux(우분투 22/24) · CPU 2코어 · RAM 4GB 이상 (검사 1건당 Chromium 1개, 동시 3건 기준) · Docker 24+ |
| 도메인·HTTPS | 선택. 있으면 Caddy(자동 HTTPS) 또는 Nginx + Let's Encrypt |
| 인터넷 | 검사 대상 사이트·Daum 맞춤법·W3C·Claude API 접속 |

## 2. 배포 (5분)
```bash
# 1) 이 폴더(deploy)를 배포 소스 루트에 두고, 소스 파일들과 같은 위치에서:
docker compose build
docker compose up -d
# 2) 확인
curl http://서버주소:3000/healthz     # {"ok":true,"version":"6.13.0","public":true}
```
브라우저에서 `http://서버주소:3000` → 아이디(아무거나)/비밀번호(GUARDIANS_PASSWORD) 입력.

## 3. 공개 모드에서 달라지는 점 (GUARDIANS_PUBLIC=1)
| 항목 | 설치형 | 인터넷용 |
|------|-------|--------|
| 내부망·사설 IP 검사 | 가능 | **차단** (서버 내부를 겨냥한 요청 방지) |
| 접근 제어 | 없음 | 비밀번호(Basic 인증). 기관 SSO가 있으면 Nginx 단에서 연동 |
| AI 키 | 서버 PC에 저장 | **서버에 저장하지 않음** — 이용자 브라우저에만 저장되어 요청마다 전달. 또는 `ANTHROPIC_API_KEY`로 서버 공용 키 |
| 예약 검사 | 사용자 PC가 켜져 있을 때 | 서버가 항상 실행 (모든 이용자가 같은 예약 목록을 봄) |
| 폐쇄망 감지 | 자동 | 서버가 인터넷에 있으므로 항상 온라인 |
| Chrome 확장 | 설치 폴더의 extension | `/extension/` 경로 파일을 내려받아 로드, 확장의 정밀 검사 주소를 서버 주소로 (popup.js의 SERVER) |

## 4. 운영 팁
- **동시 검사 제한**: 기본 3건. RAM 4GB면 3, 8GB면 5 (server.cjs `BATCH_CONCURRENCY`).
- **로그**: `docker compose logs -f guardians`
- **업데이트**: 새 버전 소스로 `docker compose build && docker compose up -d`
- **데이터**: `./data` (예약·회차 결과·설정). 백업은 이 폴더만.
- **보안**: 반드시 HTTPS 뒤에 두고 비밀번호를 설정하세요. 검사 대상 URL은 공개 웹만 허용됩니다.

## 5. Docker 없이 (Node 직접)
```bash
# Node 22, 그리고 Playwright 브라우저
npx playwright install --with-deps chromium
GUARDIANS_PUBLIC=1 GUARDIANS_PASSWORD=비밀번호 PORT=3000 node server.cjs
```
