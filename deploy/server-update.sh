#!/usr/bin/env bash
# 가디언즈 서버 업데이트 — 기존 docker-compose.yml(비밀번호)·Caddyfile·data 유지, 코드만 교체 후 재빌드
# 사용: bash server-update.sh <서버용 ZIP 경로 또는 URL>
set -e
SRC="${1:?사용법: bash server-update.sh <zip 경로 또는 URL>}"; ZIP=/tmp/guardians-update.zip
case "$SRC" in http*) curl -sL -o "$ZIP" "$SRC";; *) cp "$SRC" "$ZIP";; esac
cd /opt/guardians && sudo rm -rf /tmp/gu && mkdir -p /tmp/gu && unzip -q -o "$ZIP" -d /tmp/gu && SRCDIR=$(find /tmp/gu -maxdepth 1 -mindepth 1 -type d | head -1)
for f in server.cjs scheduler.cjs ai.cjs offline.cjs suggest.js reader.cjs krds_deep.cjs krds_tokens.cjs krds_watch.cjs krds_standard.cjs krds_palette.json pptx_node.js package.json; do [ -f "$SRCDIR/$f" ] && sudo cp "$SRCDIR/$f" ./; done
for d in public pptx_assets extension node_modules deploy; do [ -d "$SRCDIR/$d" ] && sudo rm -rf "./$d" && sudo cp -r "$SRCDIR/$d" ./; done
grep -q 'downloads:/app/downloads' docker-compose.yml || sudo sed -i 's#    volumes: \[ "./data:/app/data" \]#    volumes: [ "./data:/app/data", "./downloads:/app/downloads" ]#' docker-compose.yml
mkdir -p downloads
sudo cp deploy/Dockerfile ./Dockerfile && sudo docker compose up -d --build guardians 2>&1 | tail -2 && sleep 5
echo "UPDATE_DONE $(curl -s http://localhost:3000/healthz 2>/dev/null || sudo docker exec guardians-guardians-1 node -e "fetch('http://localhost:3000/healthz').then(r=>r.text()).then(t=>console.log(t))")"
