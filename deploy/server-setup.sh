#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  가디언즈 v6.19 — 서버 한 줄 설치 (Oracle Cloud 무료 티어 · Ubuntu 22.04/24.04 · ARM/x86 모두)
#  사용: 홈 폴더에 Guardians-v6.19-server.zip 을 올린 뒤
#        bash server-setup.sh '접근비밀번호'
#  결과: https://<IP를 -로 바꾼값>.sslip.io  (도메인 없이 HTTPS)
# ═══════════════════════════════════════════════════════════
set -e
PW="${1:-}"; ZIP="${2:-$HOME/Guardians-v6.19-server.zip}"
if [ -z "$PW" ]; then echo "사용법: bash server-setup.sh '접근비밀번호' [zip경로]"; exit 1; fi
if [ ! -f "$ZIP" ]; then echo "소스 ZIP이 없습니다: $ZIP  (scp로 먼저 올리세요)"; exit 1; fi
IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com); HOST="${IP//./-}.sslip.io"
echo "▶ 공인 IP: $IP  → 접속 주소: https://$HOST"

echo "▶ 1/6 Docker 설치"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker "$USER"; fi
sudo apt-get install -y -q unzip >/dev/null

echo "▶ 2/6 방화벽 열기 (Oracle Ubuntu는 iptables가 80/443을 막고 있음)"
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
sudo netfilter-persistent save >/dev/null 2>&1 || (sudo apt-get install -y -q iptables-persistent >/dev/null 2>&1; sudo netfilter-persistent save >/dev/null 2>&1) || true

echo "▶ 3/6 소스 풀기"
sudo rm -rf /opt/guardians && sudo mkdir -p /opt/guardians && sudo chown "$USER" /opt/guardians
unzip -q -o "$ZIP" -d /opt/guardians && cd /opt/guardians && [ -d Guardians-v6.19-server ] && mv Guardians-v6.19-server/* . && rmdir Guardians-v6.19-server || true
mkdir -p data && echo '[]' > data/schedules.json

echo "▶ 4/6 설정 파일"
cat > docker-compose.yml << YML
services:
  guardians:
    build: .
    image: guardians:6.11
    restart: unless-stopped
    environment:
      GUARDIANS_PUBLIC: "1"
      GUARDIANS_PASSWORD: "$PW"
      GUARDIANS_WEB_URL: "https://$HOST"
    volumes: [ "./data:/app/data", "./downloads:/app/downloads" ]
    shm_size: "1gb"
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: [ "80:80", "443:443" ]
    volumes: [ "./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data" ]
    depends_on: [ guardians ]
volumes: { caddy_data: {} }
YML
cat > Caddyfile << CADDY
{
    servers {
        protocols h1 h2
    }
}
$HOST {
    reverse_proxy guardians:3000
    encode gzip
}
CADDY
# 비밀번호 변경 명령 설치
sudo tee /usr/local/bin/setpw >/dev/null <<'SETPW'
#!/bin/bash
read -s -p "NEW PASSWORD: " PW; echo
PW="${PW//$'\r'/}"
[ -z "$PW" ] && { echo EMPTY_ABORT; exit 1; }
cd /opt/guardians || exit 1
sudo awk -v pw="$PW" '{ if ($1=="GUARDIANS_PASSWORD:") print "      GUARDIANS_PASSWORD: \"" pw "\""; else print }' docker-compose.yml > /tmp/dc.yml && sudo cp /tmp/dc.yml docker-compose.yml && rm -f /tmp/dc.yml
sudo docker compose up -d guardians >/dev/null 2>&1
sleep 3; echo "PASSWORD_SET_OK length=${#PW} container=$(sudo docker exec guardians-guardians-1 sh -c 'echo ${#GUARDIANS_PASSWORD}')"
SETPW
sudo chmod +x /usr/local/bin/setpw
cp deploy/Dockerfile ./Dockerfile

echo "▶ 5/6 빌드·실행 (ARM/x86 자동, 3~6분)"
sudo docker compose up -d --build

echo "▶ 6/6 확인"
sleep 8; sudo docker compose ps
echo
echo "════════════════════════════════════════════"
echo " 완료. 브라우저에서 열기:  https://$HOST"
echo " 아이디: 아무거나 / 비밀번호: (설정한 값)"
echo " 첫 접속 시 HTTPS 인증서 발급에 10~30초 걸릴 수 있습니다."
echo " 로그: cd /opt/guardians && sudo docker compose logs -f"
echo "════════════════════════════════════════════"
