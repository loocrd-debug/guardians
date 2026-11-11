// 알림 — Windows 알림(화면 오른쪽 아래) + 화면 안 알림 기록
// 설치형(Windows)에서 새 KRDS 기준이 적용되거나, 기준 · 검사 엔진의 변경이 감지되면 알려 준다.
// 끄기: 환경 변수 GUARDIANS_NOTIFY=0
const { join } = require('path'); const fs = require('fs'); const { spawn } = require('child_process')
// PowerShell 스크립트 — 제목 · 내용은 환경 변수로 넘겨 따옴표 · 한글 깨짐 문제를 피한다
const PS = `
$ErrorActionPreference = 'Stop'
$title = $env:GUARDIANS_NOTIFY_TITLE; $body = $env:GUARDIANS_NOTIFY_BODY
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $t = $xml.GetElementsByTagName('text')
  $t.Item(0).AppendChild($xml.CreateTextNode($title)) | Out-Null
  $t.Item(1).AppendChild($xml.CreateTextNode($body)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
  Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
  $n = New-Object System.Windows.Forms.NotifyIcon
  $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true
  $n.ShowBalloonTip(8000, $title, $body, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 9; $n.Dispose()
}
`
module.exports = function (app, APP_ROOT) {
  const FILE = join(APP_ROOT, 'data', 'notifications.json')
  const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { return [] } }
  const enabled = () => process.env.GUARDIANS_NOTIFY !== '0'
  function windows(title, body) {
    if (process.platform !== 'win32' || !enabled()) return false
    try { const enc = Buffer.from(PS, 'utf16le').toString('base64')
      const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
        { env: Object.assign({}, process.env, { GUARDIANS_NOTIFY_TITLE: String(title).slice(0, 120), GUARDIANS_NOTIFY_BODY: String(body).slice(0, 300) }), stdio: 'ignore', windowsHide: true, detached: true })
      c.on('error', () => {}); c.unref(); return true } catch (_) { return false } }
  function notify(title, body, meta = {}) {
    const item = { id: Date.now().toString(36), at: new Date().toISOString(), title: String(title), body: String(body), kind: meta.kind || 'info', link: meta.link || '', windows: false }
    item.windows = windows(item.title, item.body)
    try { fs.mkdirSync(join(APP_ROOT, 'data'), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify([item, ...read()].slice(0, 50), null, 1)) } catch (_) {}
    console.log('[알림]', item.title, '—', item.body); return item }
  const isLocal = req => /127\.0\.0\.1|::1$/.test(req.socket.remoteAddress || '')
  app.get('/api/notifications', (req, res) => res.json({ enabled: enabled(), windows: process.platform === 'win32', items: read().slice(0, 20) }))
  app.post('/api/notifications/test', (req, res) => { if (!isLocal(req) && req.headers['x-admin-token'] !== process.env.GUARDIANS_ADMIN_TOKEN) return res.status(403).json({ error: '이 PC에서만 시험할 수 있습니다' })
    res.json(notify('가디언즈 — 알림 시험', '알림이 정상적으로 표시됩니다. 새 KRDS 기준이 적용되면 이렇게 알려 드립니다.', { kind: 'test' })) })
  return { notify }
}
