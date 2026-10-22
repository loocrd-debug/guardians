#!/usr/bin/env bash
# 가디언즈 서버 배포 — GitHub 저장소에서 받아 반영 (수신기 · 사이트 중단 없음)
# 사용:  bash ~/guardians-repo/guardians/deploy/git-deploy.sh            # 최신 main
#        bash ~/guardians-repo/guardians/deploy/git-deploy.sh v6.20      # 특정 버전으로 (되돌리기)
# 유지:  docker-compose.yml(비밀 설정) · Caddyfile · data/(검사 기록 · 키) · node_modules · downloads
set -e
REF="${1:-main}"; REPO="$HOME/guardians-repo/guardians"; APP=/opt/guardians
cd "$REPO"
git fetch -q --tags origin
if [ "$REF" = main ]; then git checkout -q main && git reset -q --hard origin/main; else git checkout -q "$REF"; fi
VER="$(git describe --tags --always)"; echo "배포할 버전: $VER  ($(git log -1 --format='%cd · %s' --date=format:'%Y-%m-%d %H:%M'))"
cd "$APP"
for f in server.cjs scheduler.cjs ai.cjs offline.cjs suggest.js reader.cjs krds_deep.cjs krds_tokens.cjs krds_watch.cjs krds_standard.cjs krds_palette.json pptx_node.js package.json; do
  [ -f "$REPO/$f" ] && sudo cp "$REPO/$f" ./
done
for d in public pptx_assets extension deploy; do
  [ -d "$REPO/$d" ] && sudo rm -rf "./$d" && sudo cp -r "$REPO/$d" ./
done
sudo cp deploy/Dockerfile ./Dockerfile
sudo docker compose up -d --build guardians 2>&1 | tail -1
sudo chown -R 1001:1001 data
sleep 6
echo "DEPLOY_DONE $VER $(curl -s http://localhost:3000/healthz 2>/dev/null)"
