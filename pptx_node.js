/**
 * 가디언즈 오브 갤럭시 v5.6 — PPTX 생성 (Node.js / pptxgenjs)
 * 사용자 수정 기준 정확한 수치 적용
 * 폰트: 나눔고딕(본문) / 굴림(도메인)
 */
'use strict'

const PptxGenJS = require('pptxgenjs')
const path = require('path')
const fs   = require('fs')

const C = {
  white:'FFFFFF', dark:'262626', navy:'1E1E5E',
  red:'C02554', black:'000000', gray:'C0C0C0',
  panel:'2B2B4A', panelH:'1A1A3A',
  green:'16A34A', red2:'DC2626', gray2:'888888',
  bgGray:'F5F5F5', blueA:'3333AA', rowDiv:'444466',
}

const F_BODY   = '나눔고딕'
const F_DOMAIN = '굴림'

// ── ④ 신뢰도: 검사 항목을 criteria.json(KWCAG 2.2, 33개)에서 로드 — 화면·기준서·결과서 단일 원천
function loadKwcagItems() {
  try {
    const fs = require('fs'), path = require('path')
    for (const p of [path.join(__dirname, 'public', 'criteria.json'), path.join(process.cwd(), 'public', 'criteria.json')]) {
      if (fs.existsSync(p)) {
        const a = (JSON.parse(fs.readFileSync(p, 'utf8')).inspections || []).find(x => x.id === 'a11y')
        if (a && a.items && a.items.length) return a.items.map(it => ({ name: `${it.no}. ${it.name}`, rules: it.rules || [], auto: it.auto }))
      }
    }
  } catch (_) {}
  return null
}
const WCAG_ITEMS_LEGACY = [
  {name:'1. 적절한 대체 텍스트 (img)',    rules:['image-alt','input-image-alt','area-alt']},
  {name:'1. 적절한 대체 텍스트 (bg)',     rules:['image-redundant-alt']},
  {name:'1. 적절한 대체 텍스트 (object)', rules:['object-alt']},
  {name:'3. 색에 무관한 콘텐츠 인식',     rules:['color-contrast']},
  {name:'8. 초점 이동',                   rules:['focus-trap','scrollable-region-focusable']},
  {name:'12. 건너뛰기 링크',              rules:['bypass','skip-link']},
  {name:'13. 제목 제공 (<title>)',         rules:['document-title']},
  {name:'13. 제목 제공 (frame)',           rules:['frame-title','frame-tested']},
  {name:'13. 제목 제공 (<h1>~<h6>)',       rules:['heading-order','empty-heading']},
  {name:'14. 적절한 링크 텍스트',          rules:['link-name','link-in-text-block']},
  {name:'15. 기본 언어 표시',              rules:['html-has-lang','html-lang-valid']},
  {name:'16. 사용자 요구에 따른 실행',     rules:['meta-refresh']},
  {name:'18. 표의 구성',                   rules:['td-headers-attr','th-has-data-cells']},
  {name:'19. 레이블 제공',                 rules:['label','label-title-only']},
  {name:'21. 마크업 오류 방지',            rules:['duplicate-id','duplicate-id-active']},
]
const WCAG_ITEMS = loadKwcagItems() || WCAG_ITEMS_LEGACY

function getStatus(result, rules, auto) {
  if (auto === false) return 'manual'
  const violIds = new Set((result.violations||[]).map(v=>v.id))
  const passIds = new Set((result.passes||[]).map(p=>typeof p==='string'?p:(p.id||p)))
  if (rules.some(r=>violIds.has(r))) return 'fail'
  if (rules.some(r=>passIds.has(r))) return 'pass'
  return 'na'
}

// ── PNG/JPEG 헤더에서 실제 이미지 크기 읽기
function getImgSize(buf) {
  if (buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47) {
    return {w:buf.readUInt32BE(16), h:buf.readUInt32BE(20)}
  }
  let i=2
  while(i<buf.length-8) {
    if(buf[i]===0xFF&&buf[i+1]===0xC0) return {w:buf.readUInt16BE(i+7),h:buf.readUInt16BE(i+5)}
    i+=2+buf.readUInt16BE(i+2)
  }
  return null
}

// ── 비율 유지 크기 계산

// 도메인/파일명 표시용 (file:// URL은 파일명, 한글 디코딩)
function displayName(url) {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') {
      const parts = decodeURIComponent(u.pathname).split('/')
      return parts[parts.length - 1] || decodeURIComponent(url)
    }
    return u.hostname || decodeURIComponent(url)
  } catch(_) {
    try { return decodeURIComponent(url) } catch(__) { return String(url) }
  }
}

// 텍스트 말줄임 (여백 넘침 방지)
function clip(s, n) {
  s = String(s || '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function calcFit(imgW, imgH, maxW, maxH) {
  const r = Math.min(maxW/imgW, maxH/imgH)
  return {w:imgW*r, h:imgH*r}
}

function findLogo(mediaDir, name) {
  for (const ext of ['png','jpg','jpeg','PNG','JPG']) {
    const p = path.join(mediaDir, `logo_${name}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function loadLogo(logoPath) {
  if (!logoPath||!fs.existsSync(logoPath)) return null
  try {
    const buf  = fs.readFileSync(logoPath)
    const ext  = path.extname(logoPath).slice(1).toLowerCase()
    const mime = ext==='png'?'image/png':'image/jpeg'
    return {data:`data:${mime};base64,${buf.toString('base64')}`, size:getImgSize(buf)}
  } catch(_) { return null }
}

// ── 로고 삽입: 지정 영역 내 비율 유지, 정렬
function addLogoFit(slide, logoPath, areaX, areaY, areaW, areaH, align='left') {
  const logo = loadLogo(logoPath)
  if (!logo||!logo.size) return
  const {w:iw, h:ih} = logo.size
  const fit = calcFit(iw, ih, areaW, areaH)
  let x = areaX
  if (align==='center') x = areaX+(areaW-fit.w)/2
  else if (align==='right') x = areaX+areaW-fit.w
  const y = areaY+(areaH-fit.h)/2
  slide.addImage({data:logo.data, x, y, w:fit.w, h:fit.h})
}

const SW=13.333, SH=7.5

// ── 표지
function buildCover(pptx, meta, mediaDir) {
  const slide = pptx.addSlide()
  const hjP   = findLogo(mediaDir,'hj')
  const niaP  = findLogo(mediaDir,'nia')
  const solP  = findLogo(mediaDir,'solideo')

  // 로고 — 사용자 수정 기준 정확한 위치/크기
  // hj:  left=0.000 top=0.215 w=1.605 h=0.388
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  // nia: left=1.395 top=0.173 w=1.471 h=0.461
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')

  // 구분선
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.620,w:SW,h:0.025,fill:{color:C.red},  line:{color:C.red,  pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.650,w:SW,h:0.010,fill:{color:C.gray}, line:{color:C.gray, pt:0}})

  // 사업명
  const proj = meta.project||''
  if (proj) slide.addText(proj,{x:0.5,y:0.85,w:12.33,h:0.32,fontSize:11,fontFace:F_BODY,color:C.dark,align:'center'})

  // 구분선
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:1.22,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})

  // 메인 제목 — 나눔고딕 36pt bold, 자간 -150
  slide.addText('웹  ( 앱 )  접근성점검결과서',{
    x:0.5,y:1.35,w:12.33,h:1.1,
    fontSize:36,fontFace:F_BODY,bold:true,color:C.dark,align:'center',
    charSpacing:-1.5
  })

  // 구분선
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:2.6,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})

  // 수행기관 — 나눔고딕 14pt
  const dept = meta.dept||''
  slide.addText(dept,{x:0.5,y:2.8,w:12.33,h:0.5,fontSize:14,fontFace:F_BODY,color:C.dark,align:'center'})

  // 버전/날짜 — 나눔고딕 16pt
  slide.addText(meta.version||'V1.0',{x:0.5,y:3.8, w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  slide.addText(new Date().toISOString().slice(0,10),{x:0.5,y:4.15,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})

  // 솔리데오 로고 — left=5.189 top=6.000 w=2.956 h=0.469
  if (solP) addLogoFit(slide, solP, 5.189, 6.000, 2.956, 0.469, 'center')

  // 하단 선
  slide.addShape(pptx.ShapeType.rect,{x:0,y:6.8,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
}

// ── 결과 슬라이드
function buildSlide(pptx, result, meta, slideNo, mediaDir) {
  const slide = pptx.addSlide()
  const url       = result.url||''
  const pageTitle = result.pageTitle||url
  const ss        = result.screenshot
  const proj      = meta.project||meta.org||''

  let domain = displayName(url)

  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')

  // 헤더 배경
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:SW,h:0.78,fill:{color:C.white},line:{color:C.white,pt:0}})

  // 로고 — 사용자 수정 기준
  // hj:  left=0.000 top=0.215 w=1.605 h=0.388
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  // nia: left=1.395 top=0.173 w=1.471 h=0.461
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')

  // 도메인 — 굴림 20pt (사용자 기준)
  // left=3.015 top=0.111 w=8.8 h=0.55
  slide.addText(clip(domain, 48),{x:3.015,y:0.111,w:7.3,h:0.55,fontSize:20,fontFace:F_DOMAIN,bold:true,color:C.navy,fit:'shrink'})

  // 우측 문서명 — 나눔고딕 8pt
  slide.addText('웹(앱)접근성점검결과서',{x:10.5,y:0.231,w:2.8,h:0.3,fontSize:8,fontFace:F_BODY,align:'right',color:C.gray2})

  // 헤더 라인
  slide.addShape(pptx.ShapeType.rect,{x:0,   y:0.750,w:SW,   h:0.013,fill:{color:C.gray}, line:{color:C.gray, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,   y:0.699,w:1.5,  h:0.040,fill:{color:C.red},  line:{color:C.red,  pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:1.5, y:0.699,w:11.83,h:0.040,fill:{color:C.black}, line:{color:C.black,pt:0}})

  // 페이지 제목 — 나눔고딕 10pt bold
  slide.addText(clip(`※  ${pageTitle}`, 110),{x:0.220,y:0.830,w:12.9,h:0.280,fontSize:10,fontFace:F_BODY,bold:true,color:C.dark})
  // URL — 나눔고딕 7pt
  slide.addText(clip((()=>{try{return decodeURIComponent(url)}catch(_){return url}})(), 150),{x:0.220,y:1.120,w:12.9,h:0.180,fontSize:7,fontFace:F_BODY,color:C.blueA})

  // ── 좌측 패널 — left=0.12 top=1.37 w=2.65 h=5.75
  const PX=0.120, PY=1.370, PW=2.650, PH=5.750
  const ROW_H = (PH-0.220)/WCAG_ITEMS.length

  slide.addShape(pptx.ShapeType.rect,{x:PX,y:PY,      w:PW,h:PH,   fill:{color:C.panel}, line:{color:C.panel, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:PX,y:PY,      w:PW,h:0.220,fill:{color:C.panelH},line:{color:C.panelH,pt:0}})
  // 헤더 텍스트 — 나눔고딕 8pt bold
  slide.addText('검사 항목',{x:PX+0.060,y:PY+0.030,w:PW-0.120,h:0.170,fontSize:8,fontFace:F_BODY,bold:true,color:C.white})

  const FS = WCAG_ITEMS.length > 20 ? 6 : 8, BFS = WCAG_ITEMS.length > 20 ? 5.5 : 7
  WCAG_ITEMS.forEach((item,i) => {
    const iy = PY+0.220+i*ROW_H
    const st = getStatus(result,item.rules,item.auto)
    const [bc,bt] = st==='pass'?[C.green,'준수']:st==='fail'?[C.red2,'미준수']:st==='manual'?['5B6270','수동확인']:[C.gray2,'해당없음']

    if(i>0) slide.addShape(pptx.ShapeType.rect,{x:0.173,y:iy,w:2.559,h:0.007,fill:{color:C.rowDiv},line:{color:C.rowDiv,pt:0}})

    // 항목명 — 나눔고딕 8pt (사용자 기준: w=1.802)
    slide.addText(item.name + (item.auto==='partial' ? ' *' : ''),{x:PX+0.050,y:iy+0.010,w:1.802,h:ROW_H-0.020,fontSize:FS,fontFace:F_BODY,color:C.white,valign:'middle'})

    // 배지 — 나눔고딕 7pt (사용자 기준: left=2.130 w=0.600)
    const BX=2.130, BW=0.600, BH=ROW_H-0.060
    slide.addShape(pptx.ShapeType.rect,{x:BX,y:iy+0.025,w:BW,h:BH,fill:{color:bc},line:{color:bc,pt:0}})
    slide.addText(bt,{x:BX,y:iy+0.030,w:BW,h:BH,fontSize:BFS,fontFace:F_BODY,bold:true,color:C.white,align:'center',valign:'middle'})
  })
  // 범례 — 패널 하단 (기준·엔진 명시)
  const en = (result.engine||{})
  slide.addText(`KWCAG 2.2 · axe ${en.axe||''} · *부분자동`, {x:PX+0.80, y:PY+0.030, w:PW-0.86, h:0.170, fontSize:5.5, fontFace:F_BODY, color:'C8CCD8', align:'right', valign:'middle'})

  // ── 스크린샷 — left=3.961 top=1.37 w=8.178 h=5.75
  const SX=3.961, SSOY=1.370, SSW=8.178, SSH=5.750

  if (ss&&ss.length>100) {
    try {
      const buf = Buffer.from(ss,'base64')
      const sz  = getImgSize(buf)
      if (sz) {
        const fit = calcFit(sz.w, sz.h, SSW, SSH)
        slide.addImage({data:`data:image/png;base64,${ss}`,
          x:SX+(SSW-fit.w)/2, y:SSOY+(SSH-fit.h)/2, w:fit.w, h:fit.h})
      } else {
        slide.addImage({data:`data:image/png;base64,${ss}`, x:SX,y:SSOY,w:SSW,h:SSH})
      }
    } catch(e) {
      console.warn('[스크린샷]',e.message)
      _noSs(slide,SX,SSOY,SSW,SSH,pptx)
    }
  } else { _noSs(slide,SX,SSOY,SSW,SSH,pptx) }

  // ── 푸터
  const FY=7.150
  slide.addShape(pptx.ShapeType.rect,{x:0,y:FY,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText(proj,        {x:0.1,y:7.180,w:8.0, h:0.200,fontSize:7,fontFace:F_BODY,color:'666666'})
  slide.addText(`- ${slideNo} -`,{x:5.5,y:7.180,w:2.33,h:0.200,fontSize:8,fontFace:'Arial',color:'444444',align:'center'})

  // 솔리데오 로고 — left=12.007 top=7.227 w=1.173 h=0.186
  if (solP) addLogoFit(slide, solP, 12.007, 7.227, 1.173, 0.186, 'right')
}

function _noSs(slide,x,y,w,h,pptx) {
  slide.addShape(pptx.ShapeType.rect,{x,y,w,h,fill:{color:'F0F0F0'},line:{color:'DDDDDD',pt:1}})
  slide.addText('스크린샷 없음',{x,y:y+h/2-0.15,w,h:0.3,fontSize:9,fontFace:F_BODY,color:C.gray2,align:'center'})
}


// ═══ 호환성 검사 결과 슬라이드 ═══
const COMPAT_LABEL = { chrome:'Chrome', edge:'Edge', safari:'Safari (WebKit)', firefox:'Firefox' }

function buildCompatCover(pptx, meta, mediaDir) {
  const slide = pptx.addSlide()
  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.620,w:SW,h:0.025,fill:{color:C.red},line:{color:C.red,pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.650,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  const proj = meta.project||''
  if (proj) slide.addText(proj,{x:0.5,y:0.85,w:12.33,h:0.32,fontSize:11,fontFace:F_BODY,color:C.dark,align:'center'})
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:1.22,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText('웹  호환성  점검결과서',{
    x:0.5,y:1.35,w:12.33,h:1.1,
    fontSize:36,fontFace:F_BODY,bold:true,color:C.dark,align:'center',charSpacing:-1.5
  })
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:2.6,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText('Chrome · Edge · Safari(WebKit) · Firefox 렌더링 검증',{x:0.5,y:2.72,w:12.33,h:0.3,fontSize:12,fontFace:F_BODY,color:'777777',align:'center'})
  const dept = meta.dept||''
  slide.addText(dept,{x:0.5,y:3.1,w:12.33,h:0.5,fontSize:14,fontFace:F_BODY,color:C.dark,align:'center'})
  slide.addText(meta.version||'V1.0',{x:0.5,y:3.8,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  slide.addText(new Date().toISOString().slice(0,10),{x:0.5,y:4.15,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  if (solP) addLogoFit(slide, solP, 5.189, 6.000, 2.956, 0.469, 'center')
  slide.addShape(pptx.ShapeType.rect,{x:0,y:6.8,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
}

function buildCompatSlide(pptx, record, meta, slideNo, mediaDir) {
  const slide = pptx.addSlide()
  const url = record.url||''
  let domain = displayName(url)
  const proj = meta.project||meta.org||''
  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')

  // 헤더 (접근성 결과서와 동일 스타일)
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:SW,h:0.78,fill:{color:C.white},line:{color:C.white,pt:0}})
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')
  slide.addText(clip(domain, 48),{x:3.015,y:0.111,w:7.3,h:0.55,fontSize:20,fontFace:F_DOMAIN,bold:true,color:C.navy,fit:'shrink'})
  slide.addText('웹호환성점검결과서',{x:10.5,y:0.231,w:2.8,h:0.3,fontSize:8,fontFace:F_BODY,align:'right',color:C.gray2})
  slide.addShape(pptx.ShapeType.rect,{x:0,  y:0.750,w:SW,   h:0.013,fill:{color:C.gray}, line:{color:C.gray, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,  y:0.699,w:1.5,  h:0.040,fill:{color:C.red},  line:{color:C.red,  pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:1.5,y:0.699,w:11.83,h:0.040,fill:{color:C.black},line:{color:C.black,pt:0}})

  slide.addText(`※  브라우저 호환성 검증`,{x:0.220,y:0.830,w:12.9,h:0.280,fontSize:10,fontFace:F_BODY,bold:true,color:C.dark})
  slide.addText(clip((()=>{try{return decodeURIComponent(url)}catch(_){return url}})(), 150),{x:0.220,y:1.120,w:12.9,h:0.180,fontSize:7,fontFace:F_BODY,color:C.blueA})

  // 2x2 브라우저 그리드 (스크린샷 + 배지)
  const results = record.results||[]
  const GX=0.30, GY=1.45, CW=6.30, CH=2.80, GAPX=0.42, GAPY=0.28
  results.slice(0,4).forEach((r, i) => {
    const col=i%2, row=Math.floor(i/2)
    const x=GX+col*(CW+GAPX), y=GY+row*(CH+GAPY)
    const label = COMPAT_LABEL[r.browser]||r.browser

    // ═══ 브라우저별 창 목업 (증적 신뢰성 — 브라우저마다 다른 창 스타일) ═══
    // 스타일 정의: Chrome/Edge/Firefox=Windows 창(─□✕), Safari=macOS(신호등)
    const STYLE = {
      chrome:  { os:'win', bar:'DEE1E6', barText:'202124', tab:'FFFFFF', urlBg:'F1F3F4', urlText:'202124', icon:'◔' },
      edge:    { os:'win', bar:'D8E3EE', barText:'1B3A57', tab:'FFFFFF', urlBg:'EDF2F7', urlText:'1B3A57', icon:'e' },
      firefox: { os:'win', bar:'2B2A33', barText:'FFFFFF', tab:'42414D', urlBg:'1C1B22', urlText:'F9F9FA', icon:'🦊' },
      safari:  { os:'mac', bar:'ECECEE', barText:'333344', tab:'',       urlBg:'FFFFFF', urlText:'444455', icon:'🧭' },
    }
    const st = STYLE[r.browser] || STYLE.chrome

    // 창 외곽
    slide.addShape(pptx.ShapeType.roundRect,{x,y,w:CW,h:CH,rectRadius:0.05,fill:{color:'FFFFFF'},line:{color:'A8A8B2',pt:1}})

    // ① 제목바(탭바)
    const TBH = 0.26
    slide.addShape(pptx.ShapeType.roundRect,{x,y,w:CW,h:TBH,rectRadius:0.05,fill:{color:st.bar},line:{color:st.bar,pt:0}})
    slide.addShape(pptx.ShapeType.rect,{x,y:y+TBH-0.06,w:CW,h:0.06,fill:{color:st.bar},line:{color:st.bar,pt:0}})

    if (st.os === 'mac') {
      // Safari — macOS 신호등 (좌측)
      const DOT=0.085, DY=y+(TBH-DOT)/2
      ;[['FF5F57',0.10],['FEBC2E',0.24],['28C840',0.38]].forEach(([c,dx])=>{
        slide.addShape(pptx.ShapeType.ellipse,{x:x+dx,y:DY,w:DOT,h:DOT,fill:{color:c},line:{color:c,pt:0}})
      })
      slide.addText(`${st.icon} ${label}  ·  ${r.engine||''}`,{x:x+0.55,y:y+0.015,w:CW-1.6,h:TBH-0.03,fontSize:8.5,fontFace:F_BODY,bold:true,color:st.barText,valign:'middle'})
    } else {
      // Chrome/Edge/Firefox — Windows 창: 좌측 탭 + 우측 ─ □ ✕
      // 탭 (브라우저명이 담긴 둥근 탭)
      slide.addShape(pptx.ShapeType.roundRect,{x:x+0.08,y:y+0.045,w:2.30,h:TBH-0.065,rectRadius:0.07,fill:{color:st.tab},line:{color:st.tab,pt:0}})
      const tabTextC = (r.browser==='firefox') ? 'F9F9FA' : st.barText
      slide.addText(`${st.icon} ${label} · ${r.engine||''}`,{x:x+0.14,y:y+0.045,w:2.20,h:TBH-0.065,fontSize:7.5,fontFace:F_BODY,bold:true,color:tabTextC,valign:'middle'})
      // Windows 창 제어 버튼 ─ □ ✕ (우측)
      slide.addText('─    □    ✕',{x:x+CW-0.78,y:y+0.01,w:0.72,h:TBH-0.02,fontSize:8,fontFace:'Arial',color:st.barText,align:'right',valign:'middle'})
    }

    // 판정 배지 (제목바 중앙우측 — 창 버튼과 겹치지 않게)
    const [bc,bt] = r.verdict==='정상' ? [C.green,'정상'] : r.verdict==='오류 감지' ? ['D97706','오류감지'] : [C.red2,'실패']
    const badgeX = (st.os==='mac') ? x+CW-0.92 : x+CW-1.80
    slide.addShape(pptx.ShapeType.roundRect,{x:badgeX,y:y+0.035,w:0.84,h:TBH-0.07,rectRadius:0.09,fill:{color:bc},line:{color:bc,pt:0}})
    slide.addText(bt,{x:badgeX,y:y+0.035,w:0.84,h:TBH-0.07,fontSize:8,fontFace:F_BODY,bold:true,color:C.white,align:'center',valign:'middle'})

    // ② 주소창 — 브라우저별 스타일
    const ABH = 0.22, ABY = y+TBH
    slide.addShape(pptx.ShapeType.rect,{x,y:ABY,w:CW,h:ABH,fill:{color:st.os==='mac'?'F4F4F7':st.bar},line:{color:'E4E4EA',pt:0.5}})
    let dispUrl = url; try { dispUrl = decodeURIComponent(url) } catch(_) {}
    const shortUrl = dispUrl.length>80 ? dispUrl.slice(0,80)+'…' : dispUrl
    if (st.os === 'mac') {
      // Safari: 중앙 정렬 URL 필드
      slide.addShape(pptx.ShapeType.roundRect,{x:x+0.55,y:ABY+0.03,w:CW-1.10,h:ABH-0.06,rectRadius:0.08,fill:{color:st.urlBg},line:{color:'D8D8E0',pt:0.5}})
      slide.addText(`🔒 ${shortUrl}`,{x:x+0.62,y:ABY+0.03,w:CW-1.24,h:ABH-0.06,fontSize:6.8,fontFace:F_BODY,color:st.urlText,align:'center',valign:'middle'})
    } else {
      // Chrome/Edge/Firefox: 네비게이션 화살표 + 좌측 정렬 URL 필드
      const navC = (r.browser==='firefox') ? 'CCCCD6' : '5F6368'
      slide.addText('←  →  ⟳',{x:x+0.08,y:ABY+0.02,w:0.70,h:ABH-0.04,fontSize:8,fontFace:'Arial',color:navC,valign:'middle'})
      slide.addShape(pptx.ShapeType.roundRect,{x:x+0.82,y:ABY+0.03,w:CW-0.94,h:ABH-0.06,rectRadius:0.09,fill:{color:st.urlBg},line:{color:(r.browser==='firefox')?'52525E':'D8D8E0',pt:0.5}})
      slide.addText(`🔒 ${shortUrl}`,{x:x+0.90,y:ABY+0.03,w:CW-1.08,h:ABH-0.06,fontSize:6.8,fontFace:F_BODY,color:st.urlText,valign:'middle'})
    }

    // ③ 페이지 렌더링 스크린샷 (창 내부)
    const shotY=ABY+ABH+0.02, shotH=CH-TBH-ABH-0.34
    if (r.screenshot && r.screenshot.length>100) {
      try {
        const buf=Buffer.from(r.screenshot,'base64')
        const sz=getImgSize(buf)
        const mime = (buf[0]===0xFF)?'image/jpeg':'image/png'
        if (sz) {
          const fit=calcFit(sz.w,sz.h,CW-0.12,shotH)
          slide.addImage({data:`data:${mime};base64,${r.screenshot}`,x:x+0.06+(CW-0.12-fit.w)/2,y:shotY+(shotH-fit.h)/2,w:fit.w,h:fit.h})
        } else {
          slide.addImage({data:`data:${mime};base64,${r.screenshot}`,x:x+0.06,y:shotY,w:CW-0.12,h:shotH})
        }
      } catch(_) {}
    } else {
      slide.addText(r.error||'스크린샷 없음',{x:x+0.1,y:shotY+shotH/2-0.2,w:CW-0.2,h:0.4,fontSize:8,fontFace:F_BODY,color:C.gray2,align:'center'})
    }

    // ④ 하단 정보: 로드시간 · HTTP · 오류 수
    const errCnt=(r.consoleErrors||[]).length+(r.pageErrors||[]).length
    const info=`로드 ${r.loadMs?(r.loadMs/1000).toFixed(1)+'s':'-'}  ·  HTTP ${r.httpStatus||'-'}  ·  JS오류 ${errCnt}건`
    slide.addText(info,{x:x+0.10,y:y+CH-0.26,w:CW-0.20,h:0.20,fontSize:7.5,fontFace:F_BODY,color:'555566',valign:'middle'})
  })

  // 푸터
  const FY=7.150
  slide.addShape(pptx.ShapeType.rect,{x:0,y:FY,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText(proj,{x:0.1,y:7.180,w:8.0,h:0.200,fontSize:7,fontFace:F_BODY,color:'666666'})
  slide.addText(`- ${slideNo} -`,{x:5.5,y:7.180,w:2.33,h:0.200,fontSize:8,fontFace:'Arial',color:'444444',align:'center'})
  if (solP) addLogoFit(slide, solP, 12.007, 7.227, 1.173, 0.186, 'right')
}


// ═══ KRDS 준수 점검결과서 ═══
function buildKrdsCover(pptx, meta, mediaDir, tierLabel) {
  const slide = pptx.addSlide()
  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.620,w:SW,h:0.025,fill:{color:C.red},line:{color:C.red,pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.650,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  const proj = meta.project||''
  if (proj) slide.addText(proj,{x:0.5,y:0.85,w:12.33,h:0.32,fontSize:11,fontFace:F_BODY,color:C.dark,align:'center'})
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:1.22,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText('KRDS  준수  점검결과서',{
    x:0.5,y:1.35,w:12.33,h:1.1,
    fontSize:36,fontFace:F_BODY,bold:true,color:C.dark,align:'center',charSpacing:-1.5
  })
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:2.6,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText(`디지털 정부서비스 UI/UX 가이드라인(KRDS) · ${tierLabel||'표준 검사'}`,{x:0.5,y:2.72,w:12.33,h:0.3,fontSize:12,fontFace:F_BODY,color:'777777',align:'center'})
  const dept = meta.dept||''
  slide.addText(dept,{x:0.5,y:3.1,w:12.33,h:0.5,fontSize:14,fontFace:F_BODY,color:C.dark,align:'center'})
  slide.addText(meta.version||'V1.0',{x:0.5,y:3.8,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  slide.addText(new Date().toISOString().slice(0,10),{x:0.5,y:4.15,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  if (solP) addLogoFit(slide, solP, 5.189, 6.000, 2.956, 0.469, 'center')
  slide.addShape(pptx.ShapeType.rect,{x:0,y:6.8,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
}

function buildKrdsSlide(pptx, rec, meta, slideNo, mediaDir) {
  const slide = pptx.addSlide()
  const url = rec.url||''
  let domain = displayName(url)
  const proj = meta.project||meta.org||''
  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')

  // 헤더 (접근성 결과서와 동일 골격)
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:SW,h:0.78,fill:{color:C.white},line:{color:C.white,pt:0}})
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')
  slide.addText(clip(domain, 42),{x:3.015,y:0.111,w:6.1,h:0.55,fontSize:20,fontFace:F_DOMAIN,bold:true,color:C.navy,fit:'shrink'})

  // 준수율 (도메인 우측 크게)
  const rateColor = rec.score>=90 ? C.green : rec.score>=70 ? 'D97706' : C.red2
  slide.addText(`준수율 ${rec.score}%`,{x:9.3,y:0.111,w:2.4,h:0.45,fontSize:18,fontFace:F_BODY,bold:true,color:rateColor,align:'right'})
  slide.addText(`(${rec.passed}/${rec.total})`,{x:11.75,y:0.20,w:1.4,h:0.3,fontSize:10,fontFace:F_BODY,color:'888888'})

  slide.addText('KRDS준수점검결과서',{x:10.5,y:0.55,w:2.8,h:0.2,fontSize:8,fontFace:F_BODY,align:'right',color:C.gray2})
  slide.addShape(pptx.ShapeType.rect,{x:0,  y:0.750,w:SW,   h:0.013,fill:{color:C.gray}, line:{color:C.gray, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,  y:0.699,w:1.5,  h:0.040,fill:{color:C.red},  line:{color:C.red,  pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:1.5,y:0.699,w:11.83,h:0.040,fill:{color:C.black},line:{color:C.black,pt:0}})

  slide.addText(clip(`※  ${rec.pageTitle||url}  —  ${rec.tierLabel||''}`, 110),{x:0.220,y:0.830,w:12.9,h:0.280,fontSize:10,fontFace:F_BODY,bold:true,color:C.dark})
  slide.addText(clip((()=>{try{return decodeURIComponent(url)}catch(_){return url}})(), 150),{x:0.220,y:1.120,w:12.9,h:0.180,fontSize:7,fontFace:F_BODY,color:C.blueA})

  // 좌측 KRDS 규칙 패널 (개수 가변 — 동적 행높이)
  const items = rec.items||[]
  const PX=0.120, PY=1.370, PW=2.650, PH=5.750
  const ROW_H = (PH-0.220)/Math.max(items.length,1)
  const fSize = items.length>30 ? 6.5 : items.length>22 ? 7 : 8

  slide.addShape(pptx.ShapeType.rect,{x:PX,y:PY,      w:PW,h:PH,   fill:{color:C.panel}, line:{color:C.panel, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:PX,y:PY,      w:PW,h:0.220,fill:{color:C.panelH},line:{color:C.panelH,pt:0}})
  slide.addText(`KRDS 검사 항목 (${items.length})`,{x:PX+0.060,y:PY+0.030,w:PW-0.120,h:0.170,fontSize:8,fontFace:F_BODY,bold:true,color:C.white})

  items.forEach((it,i) => {
    const iy = PY+0.220+i*ROW_H
    const [bc,bt] = it.passed===true ? [C.green,'준수'] : (it.passed===false && it.partial) ? ['F0A34D','부분'] : it.passed===false ? [C.red2,'미준수'] : [C.gray2,'해당없음']
    if(i>0) slide.addShape(pptx.ShapeType.rect,{x:0.173,y:iy,w:2.559,h:0.006,fill:{color:C.rowDiv},line:{color:C.rowDiv,pt:0}})
    const nm = clip((it.level==='필수'?'★ ':'')+it.name, items.length>30 ? 16 : items.length>22 ? 18 : 22)
    slide.addText(nm,{x:PX+0.050,y:iy+0.005,w:1.802,h:Math.max(ROW_H-0.01,0.12),fontSize:fSize,fontFace:F_BODY,color:C.white,valign:'middle',fit:'shrink'})
    const BX=2.130, BW=0.600, BH=Math.max(ROW_H-0.05,0.10)
    slide.addShape(pptx.ShapeType.rect,{x:BX,y:iy+0.022,w:BW,h:BH,fill:{color:bc},line:{color:bc,pt:0}})
    slide.addText(bt,{x:BX,y:iy+0.022,w:BW,h:BH,fontSize:Math.min(fSize,7),fontFace:F_BODY,bold:true,color:C.white,align:'center',valign:'middle'})
  })

  // 우측 스크린샷
  const SX=3.961, SSOY=1.370, SSW=8.178, SSH=5.750
  const ss = rec.screenshot
  if (ss&&ss.length>100) {
    try {
      const buf=Buffer.from(ss,'base64')
      const sz=getImgSize(buf)
      const mime=(buf[0]===0xFF)?'image/jpeg':'image/png'
      if (sz) {
        const fit=calcFit(sz.w,sz.h,SSW,SSH)
        slide.addImage({data:`data:${mime};base64,${ss}`,x:SX+(SSW-fit.w)/2,y:SSOY+(SSH-fit.h)/2,w:fit.w,h:fit.h})
      } else {
        slide.addImage({data:`data:${mime};base64,${ss}`,x:SX,y:SSOY,w:SSW,h:SSH})
      }
    } catch(_) { _noSs(slide,SX,SSOY,SSW,SSH,pptx) }
  } else { _noSs(slide,SX,SSOY,SSW,SSH,pptx) }

  // 푸터
  const FY=7.150
  slide.addShape(pptx.ShapeType.rect,{x:0,y:FY,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText(proj,{x:0.1,y:7.180,w:8.0,h:0.200,fontSize:7,fontFace:F_BODY,color:'666666'})
  slide.addText(`- ${slideNo} -`,{x:5.5,y:7.180,w:2.33,h:0.200,fontSize:8,fontFace:'Arial',color:'444444',align:'center'})
  if (solP) addLogoFit(slide, solP, 12.007, 7.227, 1.173, 0.186, 'right')
}


// ═══ 커스텀 표지 (표지 편집기 — 960x540px @72dpi = 1px:1/72in, 1pt=1px) ═══
function loadCoverLayout(mediaDir) {
  try {
    const p = require('path').join(require('path').dirname(mediaDir), 'cover_layout.json')
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (j && j.enabled && Array.isArray(j.items) && j.items.length) return j
    }
  } catch(_) {}
  return null
}

function buildCustomCover(pptx, meta, layout, docTitle) {
  const slide = pptx.addSlide()
  const PX = 72  // 960px / 13.333in = 72dpi
  const today = new Date().toISOString().slice(0, 10)
  const repl = (s) => String(s || '')
    .split('{TITLE}').join(docTitle || '점검결과서')
    .split('{DATE}').join(today)
    .split('{VERSION}').join(meta.version || 'V1.0')
    .split('{PROJECT}').join(meta.project || '')
    .split('{ORG}').join(meta.org || '')
    .split('{DEPT}').join(meta.dept || '')

  for (const it of layout.items) {
    const x = it.x / PX, y = it.y / PX, w = it.w / PX, h = it.h / PX
    if (it.type === 'image' && it.data) {
      try {
        const b64 = it.data.split(',')[1] || ''
        const buf = Buffer.from(b64, 'base64')
        const sz = getImgSize(buf)
        if (sz) {
          // 편집기 박스 안에 비율 유지 (편집기도 비율 고정이므로 사실상 동일 크기)
          const fit = calcFit(sz.w, sz.h, w, h)
          slide.addImage({ data: it.data, x: x + (w - fit.w) / 2, y: y + (h - fit.h) / 2, w: fit.w, h: fit.h })
        } else {
          slide.addImage({ data: it.data, x, y, w, h })
        }
      } catch(_) {}
    } else if (it.type === 'text') {
      slide.addText(repl(it.text), {
        x, y, w, h,
        fontSize: it.fontSize || 14,       // 72dpi: px = pt 동일
        bold: !!it.bold,
        color: (it.color || '#1e2a3a').replace('#', ''),
        align: it.align || 'left',
        valign: 'top',
        fontFace: F_BODY,
        charSpacing: it.fontSize >= 30 ? -1.5 : 0,
      })
    }
  }
}


// ═══ 웹 보안 점검결과서 ═══
function buildSecurityCover(pptx, meta, mediaDir) {
  const slide = pptx.addSlide()
  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.620,w:SW,h:0.025,fill:{color:C.red},line:{color:C.red,pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0.650,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  const proj = meta.project||''
  if (proj) slide.addText(proj,{x:0.5,y:0.85,w:12.33,h:0.32,fontSize:11,fontFace:F_BODY,color:C.dark,align:'center'})
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:1.22,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText('웹  보안  점검결과서',{
    x:0.5,y:1.35,w:12.33,h:1.1,
    fontSize:36,fontFace:F_BODY,bold:true,color:C.dark,align:'center',charSpacing:-1.5
  })
  slide.addShape(pptx.ShapeType.rect,{x:0.5,y:2.6,w:12.33,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText('수동(읽기 전용) 보안 점검 · 보안 헤더 · HTTPS · 쿠키 · 정보 노출 등',{x:0.5,y:2.72,w:12.33,h:0.3,fontSize:12,fontFace:F_BODY,color:'777777',align:'center'})
  const dept = meta.dept||''
  slide.addText(dept,{x:0.5,y:3.1,w:12.33,h:0.5,fontSize:14,fontFace:F_BODY,color:C.dark,align:'center'})
  slide.addText(meta.version||'V1.0',{x:0.5,y:3.8,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  slide.addText(new Date().toISOString().slice(0,10),{x:0.5,y:4.15,w:12.33,h:0.3,fontSize:16,fontFace:F_BODY,color:'555555',align:'center'})
  if (solP) addLogoFit(slide, solP, 5.189, 6.000, 2.956, 0.469, 'center')
  slide.addShape(pptx.ShapeType.rect,{x:0,y:6.8,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
}

function buildSecuritySlide(pptx, rec, meta, slideNo, mediaDir) {
  const slide = pptx.addSlide()
  const url = rec.url||''
  const domain = displayName(url)
  const proj = meta.project||meta.org||''
  const hjP  = findLogo(mediaDir,'hj')
  const niaP = findLogo(mediaDir,'nia')
  const solP = findLogo(mediaDir,'solideo')

  slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:SW,h:0.78,fill:{color:C.white},line:{color:C.white,pt:0}})
  if (hjP)  addLogoFit(slide, hjP,  0.000, 0.215, 1.605, 0.388, 'left')
  if (niaP) addLogoFit(slide, niaP, 1.395, 0.173, 1.471, 0.461, 'left')
  slide.addText(clip(domain, 42),{x:3.015,y:0.111,w:6.1,h:0.55,fontSize:20,fontFace:F_DOMAIN,bold:true,color:C.navy,fit:'shrink'})

  const rateColor = rec.score>=90 ? C.green : rec.score>=70 ? 'D97706' : C.red2
  slide.addText(`보안점수 ${rec.score}`,{x:9.3,y:0.111,w:2.4,h:0.45,fontSize:18,fontFace:F_BODY,bold:true,color:rateColor,align:'right'})
  slide.addText(`(${rec.passed}/${rec.total})`,{x:11.75,y:0.20,w:1.4,h:0.3,fontSize:10,fontFace:F_BODY,color:'888888'})

  slide.addText('웹보안점검결과서',{x:10.5,y:0.55,w:2.8,h:0.2,fontSize:8,fontFace:F_BODY,align:'right',color:C.gray2})
  slide.addShape(pptx.ShapeType.rect,{x:0,  y:0.750,w:SW,   h:0.013,fill:{color:C.gray}, line:{color:C.gray, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:0,  y:0.699,w:1.5,  h:0.040,fill:{color:C.red},  line:{color:C.red,  pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:1.5,y:0.699,w:11.83,h:0.040,fill:{color:C.black},line:{color:C.black,pt:0}})

  slide.addText(clip(`※  ${rec.pageTitle||url}`, 110),{x:0.220,y:0.830,w:12.9,h:0.280,fontSize:10,fontFace:F_BODY,bold:true,color:C.dark})
  slide.addText(clip((()=>{try{return decodeURIComponent(url)}catch(_){return url}})(), 150),{x:0.220,y:1.120,w:12.9,h:0.180,fontSize:7,fontFace:F_BODY,color:C.blueA})

  const items = rec.items||[]
  const PX=0.120, PY=1.370, PW=2.650, PH=5.750
  const ROW_H = (PH-0.220)/Math.max(items.length,1)
  const fSize = items.length>30 ? 6.5 : items.length>22 ? 7 : 8

  slide.addShape(pptx.ShapeType.rect,{x:PX,y:PY,      w:PW,h:PH,   fill:{color:C.panel}, line:{color:C.panel, pt:0}})
  slide.addShape(pptx.ShapeType.rect,{x:PX,y:PY,      w:PW,h:0.220,fill:{color:C.panelH},line:{color:C.panelH,pt:0}})
  slide.addText(`보안 점검 항목 (${items.length})`,{x:PX+0.060,y:PY+0.030,w:PW-0.120,h:0.170,fontSize:8,fontFace:F_BODY,bold:true,color:C.white})

  items.forEach((it,i) => {
    const iy = PY+0.220+i*ROW_H
    const [bc,bt] = it.passed===true ? [C.green,'양호'] : it.passed===false ? [C.red2,'취약'] : [C.gray2,'해당없음']
    if(i>0) slide.addShape(pptx.ShapeType.rect,{x:0.173,y:iy,w:2.559,h:0.006,fill:{color:C.rowDiv},line:{color:C.rowDiv,pt:0}})
    const nm = clip((it.level==='필수'?'★ ':'')+it.name, items.length>22 ? 18 : 22)
    slide.addText(nm,{x:PX+0.050,y:iy+0.005,w:1.802,h:Math.max(ROW_H-0.01,0.12),fontSize:fSize,fontFace:F_BODY,color:C.white,valign:'middle',fit:'shrink'})
    const BX=2.130, BW=0.600, BH=Math.max(ROW_H-0.05,0.10)
    slide.addShape(pptx.ShapeType.rect,{x:BX,y:iy+0.022,w:BW,h:BH,fill:{color:bc},line:{color:bc,pt:0}})
    slide.addText(bt,{x:BX,y:iy+0.022,w:BW,h:BH,fontSize:Math.min(fSize,7),fontFace:F_BODY,bold:true,color:C.white,align:'center',valign:'middle'})
  })

  const SX=3.961, SSOY=1.370, SSW=8.178, SSH=5.750
  const ss = rec.screenshot
  if (ss&&ss.length>100) {
    try {
      const buf=Buffer.from(ss,'base64')
      const sz=getImgSize(buf)
      const mime=(buf[0]===0xFF)?'image/jpeg':'image/png'
      if (sz) {
        const fit=calcFit(sz.w,sz.h,SSW,SSH)
        slide.addImage({data:`data:${mime};base64,${ss}`,x:SX+(SSW-fit.w)/2,y:SSOY+(SSH-fit.h)/2,w:fit.w,h:fit.h})
      } else {
        slide.addImage({data:`data:${mime};base64,${ss}`,x:SX,y:SSOY,w:SSW,h:SSH})
      }
    } catch(_) { _noSs(slide,SX,SSOY,SSW,SSH,pptx) }
  } else { _noSs(slide,SX,SSOY,SSW,SSH,pptx) }

  const FY=7.150
  slide.addShape(pptx.ShapeType.rect,{x:0,y:FY,w:SW,h:0.010,fill:{color:C.gray},line:{color:C.gray,pt:0}})
  slide.addText(proj,{x:0.1,y:7.180,w:8.0,h:0.200,fontSize:7,fontFace:F_BODY,color:'666666'})
  slide.addText(`- ${slideNo} -`,{x:5.5,y:7.180,w:2.33,h:0.200,fontSize:8,fontFace:'Arial',color:'444444',align:'center'})
  if (solP) addLogoFit(slide, solP, 12.007, 7.227, 1.173, 0.186, 'right')
}

async function generatePptx(dataFile, outFile, mediaDir) {
  const payload = JSON.parse(fs.readFileSync(dataFile,'utf-8'))
  const results = payload.results||[]
  const meta    = payload.meta||{}

  const cfgPath = path.join(path.dirname(mediaDir),'config.json')
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath,'utf-8'))
      Object.entries(cfg).forEach(([k,v])=>{if(v&&!meta[k])meta[k]=v})
    } catch(_) {}
  }

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '가디언즈 오브 갤럭시 v5.6'

  if (payload.type === 'security') {
    // ── 웹 보안 점검결과서 ──
    const records = payload.records || []
    const cl0 = loadCoverLayout(mediaDir)
    if (cl0) buildCustomCover(pptx, meta, cl0, '웹 보안 점검결과서')
    else buildSecurityCover(pptx, meta, mediaDir)
    records.forEach((rec,i)=>{
      buildSecuritySlide(pptx, rec, meta, i+2, mediaDir)
      process.stdout.write(`  security ${i+1}/${records.length}: ${(rec.url||'').slice(0,60)}\n`)
    })
  } else if (payload.type === 'krds') {
    // ── KRDS 준수 점검결과서 ──
    const records = payload.records || []
    const tierLabel = records[0] ? records[0].tierLabel : ''
    const cl1 = loadCoverLayout(mediaDir)
    if (cl1) buildCustomCover(pptx, meta, cl1, 'KRDS 준수 점검결과서')
    else buildKrdsCover(pptx, meta, mediaDir, tierLabel)
    records.forEach((rec,i)=>{
      buildKrdsSlide(pptx, rec, meta, i+2, mediaDir)
      process.stdout.write(`  krds ${i+1}/${records.length}: ${(rec.url||'').slice(0,60)}\n`)
    })
  } else if (payload.type === 'compat') {
    // ── 호환성 점검결과서 ──
    const records = payload.records || []
    const cl2 = loadCoverLayout(mediaDir)
    if (cl2) buildCustomCover(pptx, meta, cl2, '웹 호환성 점검결과서')
    else buildCompatCover(pptx, meta, mediaDir)
    records.forEach((rec,i)=>{
      buildCompatSlide(pptx, rec, meta, i+2, mediaDir)
      process.stdout.write(`  compat ${i+1}/${records.length}: ${(rec.url||'').slice(0,60)}\n`)
    })
  } else {
    // ── 접근성 점검결과서 ──
    const cl3 = loadCoverLayout(mediaDir)
    if (cl3) buildCustomCover(pptx, meta, cl3, '웹 (앱) 접근성 점검결과서')
    else buildCover(pptx, meta, mediaDir)
    results.filter(r=>r&&r.url).forEach((r,i)=>{
      buildSlide(pptx, r, meta, i+2, mediaDir)
      process.stdout.write(`  ${i+1}/${results.length}: ${(r.url||'').slice(0,60)}\n`)
    })
  }

  await pptx.writeFile({fileName:outFile})
  process.stdout.write(`완료: ${outFile}\n`)
}

const [,,dataFile,outFile,mediaDir] = process.argv
if (!dataFile||!outFile){console.error('Usage: node pptx_node.js <data.json> <out.pptx> [mediaDir]');process.exit(1)}
generatePptx(dataFile,outFile,mediaDir||path.join(__dirname,'pptx_assets','media')).catch(e=>{console.error('오류:',e.message);process.exit(1)})
