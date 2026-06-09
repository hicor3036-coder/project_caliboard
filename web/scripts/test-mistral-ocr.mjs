// Mistral OCR API 테스트 스크립트
//
// 사용법:
//   node scripts/test-mistral-ocr.mjs <pdf파일경로>
//
// 환경변수:
//   MISTRAL_API_KEY (.env.local에서 자동 로드)
//
// 결과:
//   - OCR 텍스트 출력
//   - 소요 시간
//   - 응답 JSON 일부

import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'

// .env.local 직접 파싱 (dotenv 의존성 회피)
function loadEnv(path) {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}
loadEnv(resolve(process.cwd(), '.env.local'))

const apiKey = process.env.MISTRAL_API_KEY
if (!apiKey) {
  console.error('❌ MISTRAL_API_KEY가 .env.local에 없습니다.')
  process.exit(1)
}

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error('사용법: node scripts/test-mistral-ocr.mjs <pdf파일경로>')
  console.error('예: node scripts/test-mistral-ocr.mjs C:/temp/sample.pdf')
  process.exit(1)
}

if (!existsSync(pdfPath)) {
  console.error(`❌ 파일을 찾을 수 없습니다: ${pdfPath}`)
  process.exit(1)
}

console.log(`📄 파일: ${basename(pdfPath)}`)
console.log(`📦 키: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`)

// ─── Step 1: 파일 업로드 (Mistral Files API) ───
console.log('\n[1/3] Mistral Files API에 PDF 업로드 중...')
const t1 = Date.now()

const pdfBuffer = readFileSync(pdfPath)
const fileName = basename(pdfPath)

const uploadForm = new FormData()
uploadForm.append('purpose', 'ocr')
uploadForm.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName)

const uploadRes = await fetch('https://api.mistral.ai/v1/files', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: uploadForm,
})

if (!uploadRes.ok) {
  console.error(`❌ 업로드 실패: ${uploadRes.status}`)
  console.error(await uploadRes.text())
  process.exit(1)
}

const uploadData = await uploadRes.json()
const fileId = uploadData.id
console.log(`✅ 업로드 완료: file_id=${fileId} (${((Date.now() - t1) / 1000).toFixed(1)}s)`)
console.log(`   파일 정보: ${JSON.stringify(uploadData, null, 2).slice(0, 300)}`)

// ─── Step 2: signed URL 발급 ───
console.log('\n[2/3] signed URL 발급 중...')
const t2 = Date.now()

const urlRes = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url?expiry=24`, {
  headers: { 'Authorization': `Bearer ${apiKey}` },
})

if (!urlRes.ok) {
  console.error(`❌ URL 발급 실패: ${urlRes.status}`)
  console.error(await urlRes.text())
  process.exit(1)
}

const urlData = await urlRes.json()
const signedUrl = urlData.url
console.log(`✅ signed URL 발급 완료 (${((Date.now() - t2) / 1000).toFixed(1)}s)`)
console.log(`   URL 길이: ${signedUrl.length}자`)

// ─── Step 3: OCR 호출 ───
console.log('\n[3/3] OCR 호출 중...')
const t3 = Date.now()

const ocrRes = await fetch('https://api.mistral.ai/v1/ocr', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      document_url: signedUrl,
    },
    include_image_base64: false,
  }),
})

if (!ocrRes.ok) {
  console.error(`❌ OCR 실패: ${ocrRes.status}`)
  console.error(await ocrRes.text())
  process.exit(1)
}

const ocrData = await ocrRes.json()
const elapsed = (Date.now() - t3) / 1000
console.log(`✅ OCR 완료 (${elapsed.toFixed(1)}s)`)

// ─── 결과 출력 ───
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('📊 결과 요약')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`페이지 수: ${ocrData.pages?.length ?? '?'}`)
console.log(`모델: ${ocrData.model ?? '?'}`)

if (ocrData.usage_info) {
  console.log(`사용량: ${JSON.stringify(ocrData.usage_info)}`)
}

if (ocrData.pages && ocrData.pages.length > 0) {
  console.log('\n📝 첫 페이지 마크다운 (처음 2000자):')
  console.log('─────────────────────────────────────────────')
  const firstPage = ocrData.pages[0]
  const md = firstPage.markdown ?? ''
  console.log(md.slice(0, 2000))
  if (md.length > 2000) console.log(`... (총 ${md.length}자 중 2000자만 표시)`)

  if (ocrData.pages.length > 1) {
    console.log(`\n📝 추가 페이지 ${ocrData.pages.length - 1}개는 생략됨`)
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`⏱️  전체 소요: ${((Date.now() - t1) / 1000).toFixed(1)}s (업로드+URL+OCR)`)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
