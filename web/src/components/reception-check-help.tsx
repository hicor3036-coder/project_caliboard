'use client'

// 접수 점검 도움말 모달
// - reception-check.tsx의 [?] 버튼으로 토글
// - i18n.tsx 건드리지 않기 위해 한국어 하드코딩
// - public/help/ 아래 캡처 이미지 사용

import { useEffect } from 'react'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ReceptionCheckHelp({ open, onClose }: Props) {
  // ESC 키로 닫기
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-md border border-slate-200 shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">접수 점검 사용 가이드</h2>
            <p className="text-xs text-slate-500 mt-0.5">메일로 받은 교정의뢰 목록을 k-tools 접수와 대조하는 방법</p>
          </div>
          <button
            onClick={onClose}
            title="닫기 (ESC)"
            className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="overflow-y-auto px-6 py-5 space-y-8">
          {/* 인트로 */}
          <section>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">이 기능은 무엇인가요?</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              고객이 메일로 보낸 <b>교정의뢰 표</b>를 그대로 붙여넣으면,
              k-tools에 실제 접수된 데이터와 자동으로 대조해
              <b className="text-emerald-600"> 접수됨</b> / <b className="text-red-600">누락</b>을
              즉시 표시해줍니다.
            </p>
          </section>

          {/* ─── 스텝 2: 메일에서 표 드래그 (시안) ─── */}
          <Step
            num={2}
            title="메일에서 표를 드래그하세요"
            description="메일 본문에 있는 교정의뢰 표 전체를 마우스로 끌어 선택합니다."
          >
            <BeforeAfter
              beforeSrc="/help/step2-before.png"
              beforeCaption="① 메일에 이런 표가 있습니다"
              afterSrc="/help/step2-after.png"
              afterCaption="② 표 전체를 드래그하면 파랗게 선택됩니다"
            />
            <Tip>
              표의 왼쪽 위 셀부터 오른쪽 아래 셀까지 마우스 왼쪽 버튼을 누른 채로 끌어주세요.
              헤더(노란줄) 포함 <b>모든 셀이 파란색</b>으로 바뀌어야 합니다.
            </Tip>
          </Step>

          {/* ─── 스텝 3: 복사 (키보드 단축키) ─── */}
          <Step
            num={3}
            title="복사하세요 (Ctrl + C)"
            description="선택된 상태 그대로 키보드 단축키를 누릅니다."
          >
            <div className="flex items-center justify-center gap-3 py-6 bg-slate-50 rounded-md border border-slate-200">
              <KeyCap label="Ctrl" />
              <span className="text-slate-400 text-lg font-light">+</span>
              <KeyCap label="C" />
            </div>
            <Tip>
              Mac 사용자라면 <span className="font-mono">⌘ + C</span> 를 누릅니다.
              복사 후에는 표가 여전히 파랗게 선택된 상태로 보여도 정상입니다.
            </Tip>
          </Step>

          {/* ─── 스텝 4: 붙여넣기 영역에 Ctrl+V ─── */}
          <Step
            num={4}
            title="CaliBoard 붙여넣기 영역에 붙여넣으세요"
            description="이 화면의 회색 점선 영역을 한 번 클릭한 뒤, 키보드로 Ctrl + V를 누릅니다."
          >
            <figure className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-sm">
              <div className="bg-slate-50 p-3 border-b border-slate-200">
                <img src="/help/step4-paste-area.png" alt="붙여넣기 영역" className="w-full block rounded-sm" />
              </div>
              <figcaption className="px-4 py-2.5 text-sm text-slate-700 bg-white">
                회색 점선으로 둘러싸인 <b>&ldquo;여기에 표를 붙여넣으세요&rdquo;</b> 영역
              </figcaption>
            </figure>

            <div className="flex items-center justify-center gap-3 py-6 bg-slate-50 rounded-md border border-slate-200">
              <KeyCap label="Ctrl" />
              <span className="text-slate-400 text-lg font-light">+</span>
              <KeyCap label="V" />
            </div>

            <Tip>
              영역을 클릭하지 않고 Ctrl+V를 누르면 다른 곳에 붙여넣어질 수 있습니다.
              <b>반드시 점선 영역을 한 번 클릭한 뒤</b> 단축키를 누르세요.
            </Tip>
          </Step>

        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-md flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 보조 컴포넌트 ───

function Step({ num, title, description, children }: {
  num: number
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-semibold shrink-0">
          {num}
        </span>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="text-sm text-slate-600 ml-8 mb-4">{description}</p>
      <div className="ml-8 space-y-3">{children}</div>
    </section>
  )
}

function BeforeAfter({ beforeSrc, beforeCaption, afterSrc, afterCaption }: {
  beforeSrc: string
  beforeCaption: string
  afterSrc: string
  afterCaption: string
}) {
  return (
    <div className="space-y-4">
      <figure className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-sm">
        <div className="bg-slate-50 p-3 border-b border-slate-200">
          <img src={beforeSrc} alt={beforeCaption} className="w-full block rounded-sm" />
        </div>
        <figcaption className="px-4 py-2.5 text-sm text-slate-700 bg-white">
          {beforeCaption}
        </figcaption>
      </figure>

      <div className="flex justify-center">
        <div className="flex flex-col items-center text-blue-500">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span className="text-xs mt-1 font-medium">드래그</span>
        </div>
      </div>

      <figure className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-sm">
        <div className="bg-slate-50 p-3 border-b border-slate-200">
          <img src={afterSrc} alt={afterCaption} className="w-full block rounded-sm" />
        </div>
        <figcaption className="px-4 py-2.5 text-sm text-slate-700 bg-white">
          {afterCaption}
        </figcaption>
      </figure>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-900">
      <span className="shrink-0">💡</span>
      <p className="leading-relaxed">{children}</p>
    </div>
  )
}

// 키보드 키 캡 (Ctrl, C, V 같은 단축키 시각화)
function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[3rem] h-12 px-3 text-base font-semibold text-slate-700 bg-white border border-slate-300 rounded-md shadow-[0_2px_0_0_rgb(203_213_225)] font-mono">
      {label}
    </kbd>
  )
}

