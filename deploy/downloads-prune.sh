#!/usr/bin/env bash
# 최신 버전 파일만 남기고 옛 버전 삭제 (종류별로 정확히 구분)
cd /opt/guardians/downloads 2>/dev/null || exit 0
keep_latest() { ls -t 2>/dev/null $(for f in *; do [[ "$f" =~ $1 ]] && echo "$f"; done) 2>/dev/null | tail -n +2 | xargs -r rm -f; }
keep_latest '^Guardians-Setup-v[0-9.]+\.exe$'
keep_latest '^Guardians-v[0-9.]+\.zip$'
keep_latest '^Guardians-Chrome-Extension-v[0-9.]+\.zip$'
keep_latest '^Guardians-v[0-9.]+-server\.zip$'
rm -f *.part; ls -la
