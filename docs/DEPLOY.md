# 배포 흐름 (v6.21~)

1. 변경분(zip)을 `POST https://guardians.ai.kr/api/admin/incoming?name=<이름>.zip` 로 보냄  
   (헤더: `x-admin-token`, 커밋 설명은 `x-commit-msg`에 base64)
2. 서버 cron(1분마다, `deploy/incoming.sh`)이 저장소에 풀고 → **커밋 · 푸시** → `deploy/git-deploy.sh`로 반영
3. 결과 확인: `GET /api/admin/incoming/status` (같은 헤더)

- 사이트 중단 없음 · 터미널 불필요
- 되돌리기: 서버에서 `bash ~/guardians-repo/guardians/deploy/git-deploy.sh v6.20`
