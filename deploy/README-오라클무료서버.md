# Oracle Cloud 무료 서버에 가디언즈 올리기 (서울 · 0원 · 약 30분)

## A. 계정 (10분)
1. https://cloud.oracle.com → **Sign Up** → 국가 **Korea**, Home Region **South Korea Central (Seoul)** ← 나중에 못 바꾸니 꼭 서울.
2. 본인 인증 + 신용/체크카드 등록 (1달러 가승인 후 취소, 무료 티어 안에서는 청구 없음).
3. 승인 메일까지 수 분~수 시간.

## B. 서버 만들기 (10분)
1. 콘솔 → **Compute → Instances → Create Instance**
2. 이름 `guardians` / **Image**: Canonical Ubuntu **22.04** (또는 24.04) — *Minimal 아님*
3. **Shape**: Ampere → **VM.Standard.A1.Flex** → OCPU **4**, Memory **24GB** (무료 한도 전체)
   - "Out of capacity" 오류가 나면: OCPU 2 / 12GB로 줄이거나, 몇 시간 뒤 다시 시도 (서울 리전 흔한 현상)
4. **Networking**: 기본 VCN 생성, **Assign a public IPv4 address** 체크
5. **SSH keys**: "Generate a key pair" → **Save private key** (`ssh-key-….key` 다운로드, 잃어버리면 접속 불가)
6. Create → 1~2분 뒤 **Public IP** 확인 (예: 129.154.x.x)

## C. 방화벽 (3분) — 콘솔 쪽
1. 인스턴스 화면 → **Subnet** 링크 → **Security Lists** → Default Security List
2. **Add Ingress Rules** 두 번: Source `0.0.0.0/0`, Protocol TCP, Destination Port **80** / **443**
   (서버 안쪽 iptables는 설치 스크립트가 열어 줍니다)

## D. 소스 올리기 (Windows PowerShell, 2분)
```powershell
# 키 파일과 ZIP이 있는 폴더에서 (IP는 본인 값으로)
scp -i .\ssh-key.key .\Guardians-v6.13-server.zip ubuntu@129.154.x.x:~
scp -i .\ssh-key.key .\server-setup.sh ubuntu@129.154.x.x:~
ssh -i .\ssh-key.key ubuntu@129.154.x.x
```
> "WARNING: UNPROTECTED PRIVATE KEY FILE" 이 나오면 키 파일 우클릭 → 속성 → 보안 → 상속 사용 안 함 → 본인만 남기기.

## E. 설치 (서버 안, 5분)
```bash
bash server-setup.sh '원하는접근비밀번호'
```
끝나면 `https://129-154-x-x.sslip.io` 가 안내됩니다. 브라우저에서 열고 아이디 아무거나 + 비밀번호.

## F. 이후
| 할 일 | 명령 |
|------|------|
| 상태 | `cd /opt/guardians && sudo docker compose ps` |
| 로그 | `sudo docker compose logs -f guardians` |
| 재시작 | `sudo docker compose restart` |
| 업데이트 | 새 ZIP 올리고 `bash server-setup.sh '비밀번호'` 다시 (data 폴더는 유지되지 않으니 백업: `/opt/guardians/data`) |
| 도메인 생기면 | `/opt/guardians/Caddyfile` 첫 줄을 도메인으로 바꾸고 `sudo docker compose restart caddy` |

## 자주 나는 문제
- **접속 안 됨**: C단계 80/443 규칙, 그리고 `sudo iptables -L INPUT -n | head` 에 80/443 ACCEPT 있는지
- **인증서 오류**: sslip.io 주소는 첫 접속 때 발급 → 30초 뒤 새로 고침
- **Out of capacity**: 리전 용량 문제. OCPU/메모리 줄여 재시도, 또는 새벽 시간대
- **음성 명령**: HTTPS 주소에서만 마이크가 동작합니다(이 구성은 HTTPS)
