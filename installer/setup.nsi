Unicode true
!include "MUI2.nsh"
!define APPNAME "가디언즈 웹 품질 검사"
!define VER "6.20"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Guardians"
Name "${APPNAME} v${VER}"
OutFile "Guardians-Setup-v${VER}.exe"
InstallDir "$LOCALAPPDATA\Programs\Guardians"
InstallDirRegKey HKCU "Software\Guardians" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "(주)솔리데오 · 가디언즈 v${VER}"
VIProductVersion "6.20.0.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileVersion" "6.20.0"
VIAddVersionKey "CompanyName" "Solideo"
VIAddVersionKey "FileDescription" "${APPNAME} 설치"
!define MUI_ICON "setup_icon.ico"
!define MUI_UNICON "setup_icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "웹 접근성 · KRDS · 깨진 링크 · 오탈자 · HTML 표준 · 브라우저 호환 · 스크린 리더를 한 번에 검사합니다.$\r$\n$\r$\n검사용 브라우저가 포함되어 있어 행정망(인터넷 없는 환경)에서도 동작합니다.$\r$\n$\r$\n이미 설치되어 있으면 검사 기록 · 설정은 그대로 두고 프로그램만 새 버전으로 바꿉니다."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "지금 가디언즈 실행"
!define MUI_FINISHPAGE_RUN_FUNCTION RunApp
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Function .onInit
  ; 이전 설치 위치가 기록돼 있으면 그대로 사용 (업그레이드)
  ReadRegStr $0 HKCU "${REGKEY}" "InstallLocation"
  StrCmp $0 "" +2 0
  StrCpy $INSTDIR $0
FunctionEnd

Function RunApp
  ExecShell "" "$INSTDIR\START.bat"
FunctionEnd

Section "가디언즈 (필수)" SecMain
  SectionIn RO
  ; 실행 중이면 먼저 종료
  IfFileExists "$INSTDIR\STOP.bat" 0 +2
  nsExec::Exec '"$INSTDIR\STOP.bat"'
  SetOutPath "$INSTDIR"
  ; 이전 버전의 화면 · 엔진 파일 정리 (data 폴더 · 검사 브라우저는 유지)
  RMDir /r "$INSTDIR\public"
  RMDir /r "$INSTDIR\extension"
  RMDir /r "$INSTDIR\deploy"
  ; 실행에 꼭 필요한 작은 파일은 바로 넣기 (아이콘 · 실행 스크립트)
  File "payload/app.ico"
  File "payload/START.bat"
  File "payload/STOP.bat"
  File "payload/start-hidden.vbs"
  File "payload/README.txt"
  File "payload/install-extension.bat"
  File "payload/ext-guide.vbs"
  ; 프로그램 파일 4천여 개는 한 묶음으로 넣고 Windows 내장 tar로 풀기 (PowerShell이 막힌 PC 대응) → 실패 시 PowerShell
  File "app.zip"
  DetailPrint "프로그램 파일을 푸는 중… (1~2분)"
  StrCpy $1 "$SYSDIR\tar.exe"
  IfFileExists "$WINDIR\Sysnative\tar.exe" 0 +2
  StrCpy $1 "$WINDIR\Sysnative\tar.exe"
  nsExec::ExecToLog '"$1" -xf "$INSTDIR\app.zip" -C "$INSTDIR"'
  Pop $0
  IfFileExists "$INSTDIR\server.cjs" unpacked 0
  DetailPrint "tar로 풀지 못해 PowerShell로 다시 시도합니다 (코드 $0)"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath \"$INSTDIR\app.zip\" -DestinationPath \"$INSTDIR\" -Force"'
  Pop $0
  IfFileExists "$INSTDIR\server.cjs" unpacked 0
  MessageBox MB_ICONEXCLAMATION "프로그램 파일을 풀지 못했습니다.$\r$\n설치 폴더의 app.zip을 마우스 오른쪽 › [압축 풀기]로 같은 폴더에 풀어 주세요.$\r$\n$\r$\n$INSTDIR"
  Goto afterunpack
  unpacked:
  Delete "$INSTDIR\app.zip"
  afterunpack:
  ; 한글 이름 파일은 묶음 밖에서 직접 (압축 해제 도구의 문자 코드 문제 방지)
  SetOutPath "$INSTDIR\deploy"
  File "payload/deploy/README-인터넷배포.md"
  File "payload/deploy/README-오라클무료서버.md"
  SetOutPath "$INSTDIR\extension"
  File "payload/extension/설치안내.txt"
  SetOutPath "$INSTDIR"
  ; 검사용 브라우저: 이미 풀려 있으면 다시 넣지 않음
  IfFileExists "$INSTDIR\chromium\*.*" +2 0
  File "payload/chromium.zip"
  ; 기본 데이터는 없을 때만 (사용자의 검사 기록 · 설정 · 예약 보존)
  SetOutPath "$INSTDIR\data"
  SetOverwrite off
  !include "files_data.nsh"
  SetOverwrite on
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\가디언즈"
  CreateShortcut "$SMPROGRAMS\가디언즈\가디언즈 웹 품질 검사.lnk" "$INSTDIR\START.bat" "" "$INSTDIR\app.ico"
  CreateShortcut "$SMPROGRAMS\가디언즈\가디언즈 종료.lnk" "$INSTDIR\STOP.bat" "" "$INSTDIR\app.ico"
  CreateShortcut "$SMPROGRAMS\가디언즈\Chrome 확장 설치 도우미.lnk" "$INSTDIR\install-extension.bat" "" "$INSTDIR\app.ico"
  CreateShortcut "$SMPROGRAMS\가디언즈\사용 안내.lnk" "$INSTDIR\README.txt"
  CreateShortcut "$SMPROGRAMS\가디언즈\제거.lnk" "$INSTDIR\Uninstall.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Guardians" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "6.20.0"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "Solideo"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

Section "바탕화면 아이콘" SecDesk
  CreateShortcut "$DESKTOP\가디언즈 웹 품질 검사.lnk" "$INSTDIR\START.bat" "" "$INSTDIR\app.ico"
SectionEnd

Section /o "Windows 시작 시 자동 실행 (예약 검사 · KRDS 기준 자동 수신에 필요)" SecStartup
  CreateShortcut "$SMSTARTUP\가디언즈 (백그라운드).lnk" "$INSTDIR\start-hidden.vbs" "" "$INSTDIR\app.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "검사 프로그램 · 검사용 브라우저 · 사용설명서"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesk} "바탕화면에 실행 아이콘을 만듭니다"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "로그인할 때 창 없이 조용히 실행합니다"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  IfFileExists "$INSTDIR\STOP.bat" 0 +2
  nsExec::Exec '"$INSTDIR\STOP.bat"'
  Delete "$DESKTOP\가디언즈 웹 품질 검사.lnk"
  Delete "$SMSTARTUP\가디언즈 (백그라운드).lnk"
  RMDir /r "$SMPROGRAMS\가디언즈"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\Guardians"
SectionEnd
