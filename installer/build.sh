#!/bin/bash
# 설치 파일(EXE) 만들기 — 리눅스 + NSIS 3 (반드시 UTF-8 로캘: 한글 파일명에서 makensis가 멈추는 문제 방지)
#  준비물: installer/payload/runtime/node.exe (Windows Node 20), installer/payload/node_modules (Windows용), installer/payload/chromium.zip
#  사용:  bash installer/build.sh 6.21
set -e; VER=${1:?버전}; cd "$(dirname "$0")"; R=..
mkdir -p payload/data; for f in server.cjs ai.cjs reader.cjs offline.cjs scheduler.cjs suggest.js krds_deep.cjs krds_tokens.cjs krds_watch.cjs krds_standard.cjs krds_palette.json pptx_node.js package.json; do cp $R/$f payload/; done
rm -rf payload/public payload/extension payload/deploy payload/pptx_assets; cp -r $R/public $R/extension $R/deploy $R/pptx_assets payload/
cp START.bat STOP.bat start-hidden.vbs install-extension.bat ext-guide.vbs README.txt app.ico payload/
python3 - "$VER" << 'PY'
import os, sys, zipfile
root='payload'; z=zipfile.ZipFile('app.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6)
for dp,dn,fn in os.walk(root):
    rel=os.path.relpath(dp,root)
    if rel.split(os.sep)[0]=='data': continue
    for f in fn:
        a=os.path.relpath(os.path.join(dp,f),root).replace(os.sep,'/')
        if a=='chromium.zip' or any(ord(c)>127 for c in a): continue   # 한글 이름은 NSIS가 직접 설치
        z.write(os.path.join(dp,f),a)
z.close()
PY
sed -i "s/^!define VER .*/!define VER \"$VER\"/" setup.nsi
LANG=C.UTF-8 LC_ALL=C.UTF-8 makensis -V2 setup.nsi
