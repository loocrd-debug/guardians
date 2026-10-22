#!/usr/bin/env bash
# data/incoming 에 들어온 변경분(zip)을 GitHub에 커밋 · 푸시하고 서버에 반영 — cron 1분마다 (flock으로 중복 방지)
exec 9>/tmp/guardians-incoming.lock; flock -n 9 || exit 0
IN=/opt/guardians/data/incoming; REPO="$HOME/guardians-repo/guardians"; LOG="$IN/last.log"
shopt -s nullglob; for z in "$IN"/*.zip; do
  { echo "== $(date '+%F %T') $(basename "$z")"
    cd "$REPO" && git checkout -q main && git pull -q --ff-only origin main
    unzip -q -o "$z" -d "$REPO" && git add -A
    if git diff --cached --quiet; then echo "변경 없음"; else git commit -q -F "$z.msg" && git push -q origin main && echo "PUSH_OK $(git rev-parse --short HEAD)"; fi
    bash deploy/git-deploy.sh 2>&1 | tail -2
  } > "$LOG" 2>&1
  sudo rm -f "$z" "$z.msg"
done
