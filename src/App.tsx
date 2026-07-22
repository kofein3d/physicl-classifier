import React, { useState, useRef, useEffect, type ChangeEvent, type DragEvent } from 'react'
import { GoogleGenAI, Type } from '@google/genai'
import { CATEGORIES, ITEMS, WIKI_INFO, type Item } from './categories'

type Lang = 'en' | 'fr' | 'ru'

// id категории -> имена на 3 языках (для кнопок и показа результата)
const CAT_NAME = new Map(CATEGORIES.map(c => [c.id, c.name]))
// id подкатегории (L2) -> имена; код -> item (для поиска и панели-пояснения)
const SUB_NAME = new Map(CATEGORIES.flatMap(c => c.subs.map(s => [s.id, s.name])))
const ITEM_BY_CODE = new Map(ITEMS.map(it => [it.code, it]))

// id подкатегории -> коды в ней (для третьего уровня дерева категорий)
const ITEMS_BY_SUB = new Map<string, Item[]>()
for (const it of ITEMS) {
  const arr = ITEMS_BY_SUB.get(it.sub)
  if (arr) arr.push(it)
  else ITEMS_BY_SUB.set(it.sub, [it])
}
for (const arr of ITEMS_BY_SUB.values()) arr.sort((a, b) => a.code.localeCompare(b.code))

// UID -> предмет (обратный поиск: числовой код -> буквенный)

interface ClassificationResult {
  type: string      // буквенный код
  uid: string       // числовой код (UID)
  category: string  // имя категории на выбранном языке
  confidence: number
  pivot: string
}

// --- DYNAMIC BLUR BASED ON FACE ORIENTATION ---

const FACE_NORMALS: Record<string, [number, number, number]> = {
  front:  [0,  0,  1],
  back:   [0,  0, -1],
  right:  [1,  0,  0],
  left:   [-1, 0,  0],
  top:    [0, -1,  0], // CSS Y-down: "up" = -Y
  bottom: [0,  1,  0],
}

function getFaceBlur(face: string, rxDeg: number, ryDeg: number, maxBlur = 2.0): number {
  const rx = (rxDeg * Math.PI) / 180
  const ry = (ryDeg * Math.PI) / 180
  const [nx, ny, nz] = FACE_NORMALS[face] ?? [0, 0, 1]
  // apply rotateX(rx)
  const ny1 = ny * Math.cos(rx) - nz * Math.sin(rx)
  const nz1 = ny * Math.sin(rx) + nz * Math.cos(rx)
  // apply rotateY(ry) — only need z component (dot with view dir)
  const nz2 = -nx * Math.sin(ry) + nz1 * Math.cos(ry)
  return Math.max(0, -nz2) * maxBlur
}

// --- PIVOT CUBE VISUALIZATION ---

type FacePos = { face: string; x: string; y: string; half?: 'top' | 'bottom' | 'left' | 'right' | 'cornerTR' | 'cornerTL' | 'cornerBR' | 'cornerBL' }

const halfStyles: Record<string, React.CSSProperties> = {
  top:      { height: 10, borderRadius: '10px 10px 0 0', transform: 'translate(-50%, -100%)' },
  bottom:   { height: 10, borderRadius: '0 0 10px 10px', transform: 'translate(-50%, 0%)'    },
  left:     { width:  10, borderRadius: '0 10px 10px 0', transform: 'translate(0%, -50%)'    },
  right:    { width:  10, borderRadius: '10px 0 0 10px', transform: 'translate(-100%, -50%)' },
  // quarter circles for cube corners — extend toward face interior
  cornerTR: { width: 10, height: 10, borderRadius: '0 10px 0 0', transform: 'translate(0%, -100%)'    }, // right+up
  cornerTL: { width: 10, height: 10, borderRadius: '10px 0 0 0', transform: 'translate(-100%, -100%)' }, // left+up
  cornerBR: { width: 10, height: 10, borderRadius: '0 0 10px 0', transform: 'translate(0%, 0%)'       }, // right+down
  cornerBL: { width: 10, height: 10, borderRadius: '0 0 0 10px', transform: 'translate(-100%, 0%)'    }, // left+down
}

const pivotCodeMap: Record<string, FacePos[]> = {
  'A':   [{ face: 'front',  x: '50%', y: '50%'  }],
  // Corners — marker wraps across all 3 meeting faces
  // Face coord systems (derived from E1/E3/E11):
  //   front/back: x=0%=left*, y=0%=top, y=100%=bottom  (*back x is mirrored in world, same in local)
  //   top/bottom: x=0%=left, x=100%=right, y=0%=back, y=100%=front
  //   right: x=0%=front, x=100%=back, y=0%=top, y=100%=bottom
  //   left:  x=0%=back,  x=100%=front, y=0%=top, y=100%=bottom
  // Quarter rule: at (0%,?)=cornerTR/BR, at (100%,?)=cornerTL/BL; at (?,0%)=cornerBR/BL, at (?,100%)=cornerTR/TL
  'C1':  [{ face: 'bottom', x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'front',  x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'left',  x: '100%', y: '100%', half: 'cornerTL' }],
  'C2':  [{ face: 'bottom', x: '100%', y: '100%', half: 'cornerTL' }, { face: 'front',  x: '100%', y: '100%', half: 'cornerTL' }, { face: 'right', x: '0%',   y: '100%', half: 'cornerTR' }],
  'C3':  [{ face: 'bottom', x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'back',   x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'right', x: '100%', y: '100%', half: 'cornerTL' }],
  'C4':  [{ face: 'bottom', x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'back',   x: '100%', y: '100%', half: 'cornerTL' }, { face: 'left',  x: '0%',   y: '100%', half: 'cornerTR' }],
  'C5':  [{ face: 'top',    x: '0%',   y: '100%', half: 'cornerTR' }, { face: 'front',  x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'left',  x: '100%', y: '0%',   half: 'cornerBL' }],
  'C6':  [{ face: 'top',    x: '100%', y: '100%', half: 'cornerTL' }, { face: 'front',  x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'right', x: '0%',   y: '0%',   half: 'cornerBR' }],
  'C7':  [{ face: 'top',    x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'back',   x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'right', x: '100%', y: '0%',   half: 'cornerBL' }],
  'C8':  [{ face: 'top',    x: '0%',   y: '0%',   half: 'cornerBR' }, { face: 'back',   x: '100%', y: '0%',   half: 'cornerBL' }, { face: 'left',  x: '0%',   y: '0%',   half: 'cornerBR' }],
  'E1':  [
    { face: 'bottom', x: '50%', y: '100%', half: 'top'    },
    { face: 'front',  x: '50%', y: '100%', half: 'top'    },
  ],
  'E2':  [{ face: 'bottom', x: '100%', y: '50%' }],
  'E3':  [
    { face: 'bottom', x: '50%', y: '0%',   half: 'bottom' },
    { face: 'back',   x: '50%', y: '100%', half: 'top'    },
  ],
  'E4':  [{ face: 'bottom', x: '0%', y: '50%' }],
  'E5':  [{ face: 'front',  x: '0%',   y: '50%', half: 'left'  }, { face: 'left',   x: '100%', y: '50%', half: 'right' }],
  'E6':  [{ face: 'front',  x: '100%', y: '50%', half: 'right' }, { face: 'right',  x: '0%',   y: '50%', half: 'left'  }],
  'E7':  [{ face: 'back',   x: '0%',   y: '50%', half: 'left'  }, { face: 'right',  x: '100%', y: '50%', half: 'right' }],
  'E8':  [{ face: 'back',   x: '100%', y: '50%', half: 'right' }, { face: 'left',   x: '0%',   y: '50%', half: 'left'  }],
  'E9':  [{ face: 'front',  x: '50%',  y: '0%'  }],
  'E10': [{ face: 'right',  x: '50%',  y: '0%'  }],
  'E11': [
    { face: 'top',    x: '50%', y: '0%',   half: 'bottom' },
    { face: 'back',   x: '50%', y: '0%',   half: 'bottom' },
  ],
  'E12': [{ face: 'left',   x: '50%', y: '0%' }],
  'S1':  [{ face: 'bottom', x: '50%', y: '50%'  }],
  'S2':  [{ face: 'front',  x: '50%', y: '50%'  }],
  'S3':  [{ face: 'right',  x: '50%', y: '50%'  }],
  'S4':  [{ face: 'back',   x: '50%', y: '50%'  }],
  'S5':  [{ face: 'left',   x: '50%', y: '50%'  }],
  'S6':  [{ face: 'top',    x: '50%', y: '50%'  }],
  'M':   [{ face: 'front',  x: '50%', y: '50%'  }, { face: 'back',   x: '50%', y: '50%'  }, { face: 'right',  x: '50%', y: '50%'  }, { face: 'left',   x: '50%', y: '50%'  }, { face: 'top',    x: '50%', y: '50%'  }, { face: 'bottom', x: '50%', y: '50%'  }],
}

const parsePivotPositions = (pivot: string): FacePos[] => {
  if (!pivot || pivot === 'A' || pivot === 'null') return []
  // Direct code lookup (new format: "S1", "E3", "C4", "A")
  if (pivotCodeMap[pivot]) return pivotCodeMap[pivot]
  // Legacy: code in parentheses "(E3)"
  const codeMatch = pivot.match(/\b(C|E|S|A)\d*\b/)
  if (codeMatch && pivotCodeMap[codeMatch[0]]) return pivotCodeMap[codeMatch[0]]
  return [{ face: 'bottom', x: '50%', y: '50%' }]
}

const CopyIcon = ({ copied }: { copied: boolean }) =>
  copied ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )

const PivotCube = ({
  pivot, uid, code, isDark, copiedType, onCopy,
}: {
  pivot: string; uid?: string; code?: string; isDark: boolean; copiedType: string | null; onCopy: (value: string) => void
}) => {
  const positions = parsePivotPositions(pivot)
  const faces = [
    { name: 'front', label: 'Front' },
    { name: 'back', label: 'Back' },
    { name: 'top', label: 'Top' },
    { name: 'bottom', label: 'Bottom' },
    { name: 'left', label: 'Left' },
    { name: 'right', label: 'Right' },
  ]

  const [rotation, setRotation] = useState({ x: -22, y: -28 })
  const [isReturning, setIsReturning] = useState(false)
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastPos.current.x
      const dy = e.clientY - lastPos.current.y
      lastPos.current = { x: e.clientX, y: e.clientY }
      setRotation(prev => ({
        x: Math.max(-85, Math.min(0, prev.x - dy * 0.5)),
        y: prev.y + dx * 0.5,
      }))
    }
    const onMouseUp = () => {
      dragging.current = false
      setIsReturning(true)
      setRotation({ x: -22, y: -28 })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true
    setIsReturning(false)
    lastPos.current = { x: e.clientX, y: e.clientY }
  }

  return (
    <div className="flex flex-col items-center mt-6">
      <div
        className="cube-container"
        data-dark={String(isDark)}
        onMouseDown={onMouseDown}
      >
        <div
          className="cube"
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
            transition: isReturning ? 'transform 0.6s ease' : 'none',
          }}
        >
          {faces.map(({ name, label }) => (
            <div
              key={name}
              className={`cube-face ${name}`}
              style={{ filter: `blur(${getFaceBlur(name, rotation.x, rotation.y).toFixed(2)}px)` }}
            >
              {label}
              {positions.filter(p => p.face === name).map((p, i) => (
                <div
                  key={i}
                  className="pivot-point"
                  style={{ left: p.x, top: p.y, ...(p.half ? halfStyles[p.half] : { borderRadius: '50%' }) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 w-full">
        {code && (
          <div className={`px-4 py-2 rounded-[6px] flex items-center justify-center gap-2 shadow-inner ${isDark ? 'bg-[#404040]' : 'bg-gray-100'}`}>
            <span className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>CODE:</span>
            <span className="text-base font-mono truncate" style={{ color: 'rgb(120, 175, 230)' }}>{code}</span>
            <button
              onClick={() => onCopy(code)}
              className={`shrink-0 transition-colors ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
              aria-label={`Copy ${code}`}
            >
              <CopyIcon copied={copiedType === code} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <div className={`flex-1 px-4 py-2 rounded-[6px] flex items-center justify-center gap-2 shadow-inner ${isDark ? 'bg-[#404040]' : 'bg-gray-100'}`}>
            <span className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Pivot:</span>
            <span className="text-base font-mono" style={{ color: 'rgb(120, 175, 230)' }}>{pivot}</span>
            <button
              onClick={() => onCopy(pivot)}
              className={`transition-colors ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
              aria-label={`Copy ${pivot}`}
            >
              <CopyIcon copied={copiedType === pivot} />
            </button>
          </div>
          {uid && (
            <div className={`flex-1 px-4 py-2 rounded-[6px] flex items-center justify-center gap-2 shadow-inner ${isDark ? 'bg-[#404040]' : 'bg-gray-100'}`}>
              <span className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>UID:</span>
              <span className="text-base font-mono" style={{ color: 'rgb(120, 175, 230)' }}>{uid}</span>
              <button
                onClick={() => onCopy(uid)}
                className={`transition-colors ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                aria-label={`Copy ${uid}`}
              >
                <CopyIcon copied={copiedType === uid} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- LOADING INDICATOR ---

const stageLabels = ['', 'Scanning image...', 'Classifying objects...']

function LoadingIndicator({ stage, isDark }: { stage: 1 | 2; isDark: boolean }) {
  const accent = isDark ? '#c8963c' : '#c8963c'
  return (
    <div className="flex flex-col items-center justify-center mt-8 space-y-4">
      <svg className={`animate-spin h-8 w-8 ${isDark ? '' : 'text-blue-500'}`} style={accent ? { color: accent } : undefined} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <p className="text-lg text-gray-500">{stageLabels[stage]}</p>
      <div className="flex space-x-2">
        {[1, 2].map(s => (
          <div
            key={s}
            className={`h-2 w-8 rounded-full transition-all duration-300 ${s <= stage ? '' : 'opacity-30'} ${isDark ? '' : s <= stage ? 'bg-blue-500' : 'bg-blue-300'}`}
            style={isDark ? { backgroundColor: accent } : undefined}
          />
        ))}
      </div>
    </div>
  )
}

// --- RESULT DISPLAY ---

interface ResultDisplayProps {
  loadingStage: 0 | 1 | 2 | 3
  error: string | null
  notFound: boolean
  results: ClassificationResult[]
  selectedResultIndex: number | null
  copiedType: string | null
  isDark: boolean
  onCopy: (type: string) => void
  onSelectResult: (index: number) => void
}

function ResultDisplay({
  loadingStage, error, notFound, results, selectedResultIndex,
  copiedType, isDark, onCopy, onSelectResult,
}: ResultDisplayProps) {
  if (loadingStage > 0) {
    return <LoadingIndicator stage={loadingStage as 1 | 2} isDark={isDark} />
  }

  if (error) {
    return <p className="mt-8 text-center text-red-400 bg-red-900/20 p-4 rounded-lg">{error}</p>
  }

  if (notFound) {
    return <p className={`mt-8 text-center text-2xl font-semibold ${isDark ? 'text-gray-400' : 'text-gray-700'}`}>Not found</p>
  }

  if (results.length > 0) {
    return (
      <div className="w-full">
        <h2 className={`text-base font-semibold mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Found:</h2>
        <ul className="tree-scroll rounded-lg p-1 max-h-[313px] overflow-y-auto">
          {results.map((result, index) => (
            <li
              key={index}
              onClick={() => onSelectResult(index)}
              className={`flex items-center justify-between px-2 py-1 rounded transition-all duration-150 cursor-pointer
                ${selectedResultIndex === index
                  ? isDark ? 'bg-[#282828] border-l-2 border-gray-400' : 'bg-gray-200 border-l-2 border-gray-500'
                  : isDark ? 'hover:bg-[#2e2e2e]' : 'hover:bg-gray-100'
                } ${isDark ? 'text-gray-100' : 'text-gray-800'}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectResult(index)}
            >
              <div className="flex flex-col min-w-0 mr-2">
                <span className="font-mono text-sm truncate">{result.type}{result.uid && <span className={isDark ? 'text-gray-500' : 'text-gray-400'}> · {result.uid}</span>}</span>
                {result.category && <span className={`text-xs truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{result.category.toUpperCase()}</span>}
              </div>
              <div className="flex items-center space-x-1.5 flex-shrink-0">
                <span className={`text-xs font-semibold px-1.5 ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
                  {Math.round(result.confidence * 100)}%
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(result.type) }}
                  className={`transition-colors ${isDark ? 'text-gray-600 hover:text-gray-300' : 'text-gray-300 hover:text-gray-600'}`}
                  aria-label={`Copy ${result.type}`}
                >
                  {copiedType === result.type ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return null
}

// --- CATEGORY TREE (отдельная колонка слева от карточки) ---

interface CategoryTreeProps {
  lang: Lang
  isDark: boolean
  selectedCategory: string | null
  onSelectCategory: (id: string | null) => void
}

// цвет Wiki-кода по статусу (none=красный, doubtful=жёлтый, exact=зелёный, climbed/иное=серый)
const wikiColorOf = (status: string | undefined, isDark: boolean) =>
  status === 'none' ? '#ea0000'
    : status === 'doubtful' ? '#e0b000'
      : status === 'exact' ? (isDark ? '#4bbf6f' : '#2e9e57')
        : (isDark ? '#888' : '#999')

const CategoryTree = ({ lang, isDark, selectedCategory, onSelectCategory }: CategoryTreeProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Фильтр: строго "Q"+цифры (Q15148) → по Wiki-коду (wikiId); иначе → подстрока по буквенному коду.
  // При фильтре узлы авто-развёрнуты и видны только совпавшие листья.
  const q = query.trim()
  const filtering = q.length > 0
  const isWiki = /^Q\d+$/.test(q)
  const matchItem = (it: Item) => !filtering || (isWiki ? (it.wikiId || '') === q : it.code.includes(q))
  const sel = selectedCode ? ITEM_BY_CODE.get(selectedCode) : null

  // absolute относительно ближайшего relative-предка (обёртка вокруг карточки) — приклеено
  // к левому краю карточки, двигается вместе с ней, не участвует в её центрировании
  return (
    <div className="absolute top-0 bottom-0 w-[480px] flex flex-col p-0" style={{ right: 'calc(100% + 24px)' }}>
      <input
        value={query}
        onChange={e => { const v = e.target.value.toUpperCase(); setQuery(v); if (!v) setSelectedCode(null) }}
        placeholder="Search: CODE or Wiki-code…"
        autoComplete="off"
        className={`shrink-0 mb-8 ml-[10px] mr-5 h-8 rounded px-2 text-sm font-mono border focus:outline-none focus:ring-1 ${isDark ? 'bg-[#262626] border-gray-600 text-gray-200 placeholder-gray-600 focus:ring-[#c8963c]' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400 focus:ring-blue-400'}`}
      />
      <p className={`shrink-0 flex justify-between text-sm font-semibold uppercase tracking-wide mb-5 pl-[10px] pr-10 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}><span>Categories</span><span className="font-mono normal-case">{ITEMS.length}</span></p>
      <ul className="tree-scroll overflow-y-auto pr-5 space-y-0.5 flex-1">
        {CATEGORIES.map(c => {
          // подкатегории с (отфильтрованными) элементами; при фильтре пустые убираем
          const subData = c.subs
            .map(s => { const all = ITEMS_BY_SUB.get(s.id) ?? []; return { s, items: filtering ? all.filter(matchItem) : all } })
            .filter(x => !filtering || x.items.length > 0)
          if (filtering && subData.length === 0) return null
          const isOpen = filtering ? true : expanded.has(c.id)
          const isSelected = selectedCategory === c.id
          const catCount = filtering ? subData.reduce((n, x) => n + x.items.length, 0) : c.subs.reduce((sum, s) => sum + (ITEMS_BY_SUB.get(s.id)?.length ?? 0), 0)
          return (
            <li key={c.id}>
              <div className={`flex items-center gap-1 rounded px-1.5 py-1 text-sm transition-colors ${
                isSelected
                  ? isDark ? 'bg-[#4a4a4a] text-gray-100' : 'bg-gray-200 text-gray-900'
                  : isDark ? 'text-gray-300 hover:bg-[#3a3a3a]' : 'text-gray-700 hover:bg-gray-100'
              }`}>
                <button
                  onClick={() => toggle(c.id)}
                  disabled={filtering}
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                  className={`shrink-0 w-4 text-center text-base font-bold transition-transform disabled:opacity-40 ${isOpen ? 'rotate-90' : ''}`}
                  style={{ color: '#ffcc6f' }}
                >▸</button>
                <button
                  onClick={() => onSelectCategory(isSelected ? null : c.id)}
                  className="flex-1 text-left truncate"
                  style={{ color: '#ffcc6f' }}
                  title={c.name[lang]}
                >{c.name[lang]}</button>
                <span className="shrink-0 text-xs font-mono" style={{ color: '#ffcc6f' }}>{catCount}</span>
              </div>
              {isOpen && (
                <ul className="ml-5 border-l border-dashed pl-2 mt-0.5 mb-1 space-y-0.5" style={{ borderColor: isDark ? '#444' : '#e5e7eb' }}>
                  {subData.map(({ s, items }) => {
                    const isSubOpen = filtering ? true : expanded.has(s.id)
                    return (
                      <li key={s.id}>
                        <div className="flex items-center gap-1 px-1.5 py-0.5">
                          <button
                            onClick={() => toggle(s.id)}
                            aria-label={isSubOpen ? 'Collapse' : 'Expand'}
                            disabled={filtering || items.length === 0}
                            className={`shrink-0 w-4 text-center text-base font-bold transition-transform disabled:opacity-0 ${isSubOpen ? 'rotate-90' : ''}`}
                            style={{ color: '#7dbeff' }}
                          >▸</button>
                          <span className="text-sm truncate flex-1" style={{ color: '#7dbeff' }} title={s.name[lang]}>
                            {s.name[lang]}
                          </span>
                          <span className="shrink-0 text-xs font-mono" style={{ color: '#7dbeff' }}>{items.length}</span>
                        </div>
                        {isSubOpen && (
                          <ul className="ml-4 border-l border-dashed pl-2 mt-0.5 mb-0.5" style={{ borderColor: isDark ? '#3a3a3a' : '#eee' }}>
                            {items.map(it => {
                              const wikiText = it.wikiId || 'none'
                              const isCodeSel = selectedCode === it.code
                              return (
                                <li key={it.code}>
                                  <button
                                    onClick={() => setSelectedCode(isCodeSel ? null : it.code)}
                                    title={it.code}
                                    className={`w-full flex items-center gap-2 text-sm font-mono px-1.5 py-px rounded text-left transition-colors ${isCodeSel ? (isDark ? 'bg-[#4a4a4a]' : 'bg-gray-200') : (isDark ? 'hover:bg-[#3a3a3a]' : 'hover:bg-gray-100')}`}
                                  >
                                    <span className="flex-1 truncate" style={{ color: '#ff8edf' }}>{it.code}</span>
                                    <span className="shrink-0 text-xs" style={{ color: wikiColorOf(it.wikiStatus, isDark) }} title={`Wiki: ${wikiText}`}>{wikiText}</span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      {sel && (
        <div className={`shrink-0 mt-2 ml-[10px] mr-5 p-3 rounded border text-sm ${isDark ? 'bg-[#2a2a2a] border-[#c8963c] text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono font-semibold truncate" style={{ color: '#ff8edf' }}>{sel.code}</span>
            <button onClick={() => setSelectedCode(null)} className="shrink-0 ml-2 text-xs opacity-50 hover:opacity-100">✕</button>
          </div>
          <div className="text-xs opacity-70 mb-2">{CAT_NAME.get(sel.cat)?.[lang]} › {SUB_NAME.get(sel.sub)?.[lang]}</div>
          <div className="text-sm">{sel.search[lang]}</div>
          <div className="mt-2 text-xs font-mono">Wiki: <span style={{ color: wikiColorOf(sel.wikiStatus, isDark) }}>{sel.wikiId || 'none'}</span></div>
          {/* C/ имя Wiki-сущности и D/ её определение (англ, из WIKI_INFO) — только если запись есть */}
          {sel.wikiId && WIKI_INFO[sel.wikiId]?.name && (
            <div className="mt-1 text-sm font-medium">{WIKI_INFO[sel.wikiId]!.name}</div>
          )}
          {sel.wikiId && WIKI_INFO[sel.wikiId]?.def && (
            <div className="mt-0.5 text-xs opacity-70">{WIKI_INFO[sel.wikiId]!.def}</div>
          )}
        </div>
      )}
    </div>
  )
}

// --- MAIN APP ---

interface AppProps {
  apiKeys: string[]
  isDark: boolean
  onAddKey: (key: string) => void
  onRemoveKey: (index: number) => void
}

export function App({ apiKeys, isDark, onAddKey, onRemoveKey }: AppProps) {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loadingStage, setLoadingStage] = useState<0 | 1 | 2 | 3>(0)
  const [results, setResults] = useState<ClassificationResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedType, setCopiedType] = useState<string | null>(null)
  const [selectedResultIndex, setSelectedResultIndex] = useState<number | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)   // теперь хранит id категории
  const [lang, setLang] = useState<Lang>('en')
  // Высота блока чипсов категорий фиксируется по самому высокому языковому варианту
  // (обычно RU/FR длиннее EN), чтобы переключение языка не меняло высоту окна.
  const chipsRef = useRef<HTMLDivElement>(null)
  const hiddenChipsRef = useRef<Record<Lang, HTMLDivElement | null>>({ en: null, fr: null, ru: null })
  const [minChipsHeight, setMinChipsHeight] = useState(0)
  useEffect(() => {
    const heights = (['en', 'fr', 'ru'] as Lang[]).map(l => hiddenChipsRef.current[l]?.scrollHeight ?? 0)
    setMinChipsHeight(Math.max(...heights, 0))
  }, [])
  const [usedModel, setUsedModel] = useState<string | null>(null)
  // Инфо о кэше: сколько токенов пришло из implicit-кэша и сколько всего в промпте.
  // Нужно, чтобы глазами увидеть, работает ли кэширование на бесплатном тире.
  const [cacheInfo, setCacheInfo] = useState<{ cached: number; total: number } | null>(null)
  // Счётчик обработанных картинок за текущую сессию (для контроля расхода квоты).
  const [processedCount, setProcessedCount] = useState(0)
  const [activeKeyIndex, setActiveKeyIndex] = useState(0)
  const [everExpanded, setEverExpanded] = useState(false)
  const [hasClassified, setHasClassified] = useState(false)
  const [showApiMenu, setShowApiMenu] = useState(false)
  const [newKeyInput, setNewKeyInput] = useState('')
  const [showKeyGuide, setShowKeyGuide] = useState(false)
  const [guideKeyInput, setGuideKeyInput] = useState('')

  async function fileToGenerativePart(file: File) {
    const MAX_PX = 1024
    const base64 = await new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
      }
      img.src = URL.createObjectURL(file)
    })
    return {
      inlineData: { data: base64, mimeType: 'image/jpeg' },
    }
  }

  const handleFile = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      setImageFile(file)
      setImageUrl(URL.createObjectURL(file))
      setResults([])
      setError(null)
      setNotFound(false)
      setSelectedResultIndex(null)
    } else {
      setError('Please provide an image file.')
    }
  }

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  useEffect(() => {
    if (!showApiMenu) return
    const close = () => setShowApiMenu(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [showApiMenu])

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) { handleFile(file); break }
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  const handleDragEnter = (e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }
  const handleDragLeave = (e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }
  const handleDragOver = (e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); e.stopPropagation() }
  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleCopy = (type: string) => {
    navigator.clipboard.writeText(type)
    setCopiedType(type)
    setTimeout(() => setCopiedType(null), 2000)
  }

  const handleClassify = async () => {
    if (!imageFile) { setError('Please select an image first.'); return }
    if (apiKeys.length === 0) {
      setShowKeyGuide(true)
      return
    }

    setEverExpanded(true)
    setHasClassified(true)
    setLoadingStage(1)
    setError(null)
    setResults([])
    setNotFound(false)
    setSelectedResultIndex(null)
    setUsedModel(null)
    setCacheInfo(null)

    try {
      const imagePart = await fileToGenerativePart(imageFile)

      const pool = selectedCategory ? ITEMS.filter(it => it.cat === selectedCategory) : ITEMS
      // Один searchName (EN) может относиться к нескольким предметам (варианты L/R и т.п.) —
      // храним ВСЕ предметы с этим именем, чтобы на выходе показать каждый.
      const searchNameToItems = new Map<string, Item[]>()
      for (const it of pool) {
        const arr = searchNameToItems.get(it.search.en)
        if (arr) arr.push(it)
        else searchNameToItems.set(it.search.en, [it])
      }
      // в список для Gemini отдаём УНИКАЛЬНЫЕ имена (без повторов)
      const searchList = [...searchNameToItems.keys()].join('\n')

      const prompt = `You are a product classifier. Identify all object(s) in the image and match them to items from the list below.

  Rules:
  - Analyze every visible object in the image separately
  - For each object, include: exact matches, synonyms, alternative names, and related product types
  - Return exact item names from the list
  - Confidence: 1.0 = exact match, 0.7 = synonym/variant, 0.4 = related/possible match
  - Minimum confidence to include: 0.4
  - If no match found, return empty array

Items:
${searchList}`
      const schema = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type:       { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
                required: ['type', 'confidence'],
              },
            },
          },
        },
      }

      const models = ['gemini-3.5-flash', 'gemini-3.1-flash-lite']
      let response = null
      let usedKeyIdx = activeKeyIndex

      outer: for (let keyIdx = activeKeyIndex; keyIdx < apiKeys.length; keyIdx++) {
        const ai = new GoogleGenAI({ apiKey: apiKeys[keyIdx] })
        for (const model of models) {
          try {
            response = await ai.models.generateContent({
              model,
              // Порядок важен: статический текст со списком идёт ПЕРВЫМ (стабильный
              // префикс для implicit-кэша), а меняющаяся картинка — последней.
              contents: { parts: [{ text: prompt }, imagePart] },
              config: schema,
            })
            usedKeyIdx = keyIdx
            setUsedModel(model)
            break outer
          } catch (err) {
            const is429 = err instanceof Error && (err.message.includes('429') || err.message.includes('quota'))
            if (!is429) throw err
            if (model !== models[models.length - 1]) continue
          }
        }
      }
      setActiveKeyIndex(usedKeyIdx)

      if (!response) throw new Error('429: All API keys quota exceeded.')

      // Снимаем метрики токенов из ответа. cachedContentTokenCount > 0 означает,
      // что часть промпта (список категорий) реально пришла из кэша.
      const usage = response.usageMetadata
      setCacheInfo({ cached: usage?.cachedContentTokenCount ?? 0, total: usage?.promptTokenCount ?? 0 })
      setProcessedCount(c => c + 1)

      const parsed = JSON.parse(response.text ?? '{}')
      const itemResults: { type: string; confidence: number }[] = parsed.results ?? []

      if (itemResults.length === 0) {
        setNotFound(true)
        return
      }

      const finalResults: ClassificationResult[] = itemResults.flatMap(r => {
        // все предметы с таким searchName (обычно один; для вариантов — несколько)
        const its = searchNameToItems.get(r.type) ?? []
        return its.map(it => ({
          type: it.code,
          uid: it.uid,
          category: CAT_NAME.get(it.cat)?.[lang] ?? it.cat,
          confidence: r.confidence,
          pivot: it.pivot,
        }))
      })

      setResults(finalResults)
      setSelectedResultIndex(0)
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('429') || msg.includes('quota') || msg.includes('limit')) {
        setError(
          apiKeys.length > 1
            ? 'All API keys quota exceeded. Try again after midnight Pacific Time.'
            : 'Daily token quota exceeded. Add more API keys or try again after midnight Pacific Time.'
        )
      } else {
        setError(`Error: ${msg || 'An unexpected error occurred.'}`)
      }
    } finally {
      setLoadingStage(0)
    }
  }

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-4 md:p-8 ${isDark ? 'bg-[#282828]' : 'bg-gray-100'}`}>
      {/* relative-обёртка: дерево (absolute) приклеено к карточке и центрируется вместе с ней;
          дерево out-of-flow, поэтому НЕ влияет на расчёт центрирования — центрируется сама карточка */}
      <div className={`relative w-full mx-auto ${hasClassified ? 'max-w-6xl translate-x-20' : 'max-w-[600px]'}`}>
        <CategoryTree lang={lang} isDark={isDark} selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
        <div className={`p-8 rounded-2xl shadow-xl w-full mx-auto min-h-[694px] ${everExpanded ? 'transition-[max-width] duration-500 ease-out' : ''} ${hasClassified ? 'max-w-6xl' : 'max-w-[600px]'} ${isDark ? 'bg-[#333333]' : 'bg-white'}`}>
        <div className="flex gap-8 items-start">
          {/* Left: Title + Uploader — fixed width, never reflows */}
          <div className="w-[536px] shrink-0 min-h-[656px]">
            {/* Title row */}
            <div className="flex items-start justify-between mb-3">
              <h1 className={`text-2xl font-bold ${isDark ? '' : 'text-gray-800'}`} style={isDark ? { color: '#c8963c' } : undefined}>
                Category classifier
              </h1>
              <div className="flex flex-col items-end gap-1">
                {/* Переключатель языка EN/FR/RU */}
                <div className="flex gap-0.5">
                  {(['en', 'fr', 'ru'] as Lang[]).map(l => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${
                        lang === l
                          ? isDark ? 'text-black' : 'bg-blue-600 text-white'
                          : isDark ? 'bg-[#444] text-gray-400 hover:bg-[#555]' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                      style={isDark && lang === l ? { backgroundColor: '#c8963c' } : undefined}
                    >{l.toUpperCase()}</button>
                  ))}
                </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>v2.05</span>
                <a
                  href="./pivot.html"
                  className={`text-xs underline px-1 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Pivot lookup
                </a>
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowApiMenu(v => !v) }}
                    className={`text-xs underline px-1 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    API keys ({apiKeys.length})
                  </button>
                  {showApiMenu && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`absolute right-0 top-6 z-50 w-72 rounded-lg shadow-xl p-3 text-xs ${isDark ? 'bg-[#2a2a2a] border border-gray-700 text-gray-300' : 'bg-white border border-gray-200 text-gray-700'}`}
                    >
                      <p className="font-semibold mb-2">API Keys</p>
                      <ul className="space-y-1 mb-3">
                        {apiKeys.map((k, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span className={`font-mono ${i === activeKeyIndex ? (isDark ? 'text-green-400' : 'text-green-600') : ''}`}>
                              {i === activeKeyIndex ? '● ' : '○ '}{k.slice(0, 6)}…{k.slice(-4)}
                            </span>
                            <button
                              onClick={() => onRemoveKey(i)}
                              className="text-red-400 hover:text-red-300 flex-shrink-0"
                            >✕</button>
                          </li>
                        ))}
                      </ul>
                      <hr className={`mb-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`} />
                      <p className={`mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Add key from another Google account:</p>
                      <div className="flex gap-1">
                        <input
                          type="password"
                          value={newKeyInput}
                          onChange={e => setNewKeyInput(e.target.value)}
                          placeholder="AIza..."
                          className={`flex-1 min-w-0 border rounded px-2 py-1 font-mono ${isDark ? 'bg-[#333] border-gray-600 text-gray-100 placeholder-gray-600' : 'border-gray-300'}`}
                        />
                        <button
                          onClick={() => { if (newKeyInput.trim()) { onAddKey(newKeyInput.trim()); setNewKeyInput('') } }}
                          disabled={!newKeyInput.trim()}
                          className="px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-40"
                        >Add</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              </div>
            </div>
            <label
              htmlFor="file-upload"
              className="w-full cursor-pointer"
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className={`flex justify-center rounded-lg border border-dashed transition-colors duration-300 ${imageUrl ? 'px-6 py-4' : 'px-6 py-10'}
                ${isDragging
                  ? 'border-blue-500 bg-blue-900/20'
                  : isDark ? 'border-gray-600 hover:border-gray-400' : 'border-gray-900/25 hover:border-gray-400'
                }`}>
                {imageUrl ? (
                  <img src={imageUrl} alt="Preview" className="max-h-[230px] rounded-lg object-contain" />
                ) : (
                  <div className="text-center">
                    <svg className={`mx-auto h-12 w-12 ${isDark ? 'text-gray-600' : 'text-gray-300'}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
                    </svg>
                    <div className="mt-4 flex text-sm leading-6 justify-center">
                      <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Click to upload or drag and drop</p>
                    </div>
                    <p className={`text-xs leading-5 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>PNG, JPG, etc.</p>
                  </div>
                )}
              </div>
            </label>
            <input id="file-upload" name="file-upload" type="file" className="sr-only" accept="image/*" onChange={handleImageChange} />

            <button
              onClick={handleClassify}
              disabled={!imageFile || loadingStage > 0}
              className={`mt-6 w-full font-bold py-1 px-4 rounded-[6px] disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-opacity-50 ${isDark ? 'text-black focus:ring-[#c8963c]' : 'text-white bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'}`}
              style={isDark ? { backgroundColor: '#c8963c' } : undefined}
              onMouseEnter={e => { if (isDark) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#b07e2e' }}
              onMouseLeave={e => { if (isDark) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#c8963c' }}
            >
              {loadingStage > 0
                ? stageLabels[loadingStage]
                : selectedCategory ? `Classify in ${(CAT_NAME.get(selectedCategory)?.[lang] ?? selectedCategory).toUpperCase()}` : 'CLASSIFY IMAGE'}
            </button>

            {/* Category filter chips */}
            <div className="mt-4 relative overflow-hidden">
              <p className={`text-xs mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Filter by category:</p>
              {/* flex-wrap как раньше; высота зафиксирована ниже (minChipsHeight) по самому
                  высокому варианту среди языков — переключение EN/FR/RU не меняет высоту окна. */}
              <div className="flex flex-wrap gap-1.5" style={{ minHeight: minChipsHeight || undefined }} ref={chipsRef}>
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`flex-auto px-2.5 py-0.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    selectedCategory === null
                      ? isDark ? 'text-black' : 'bg-amber-600/80 text-white'
                      : isDark ? 'bg-[#444] text-gray-500 hover:bg-[#555]' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  style={isDark && selectedCategory === null ? { backgroundColor: '#c8963c' } : undefined}
                >
                  ALL
                </button>
                {CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCategory(c.id === selectedCategory ? null : c.id)}
                    className={`flex-auto px-2.5 py-0.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      selectedCategory === c.id
                        ? isDark ? 'text-black' : 'bg-blue-600 text-white'
                        : isDark ? 'bg-[#444] text-gray-300 hover:bg-[#555]' : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
                    }`}
                    style={isDark && selectedCategory === c.id ? { backgroundColor: '#c8963c' } : undefined}
                  >
                    {c.name[lang].toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Невидимые копии для замера высоты на каждом языке (см. minChipsHeight выше) */}
              <div aria-hidden className="absolute opacity-0 pointer-events-none -z-10 top-0 left-0 w-[536px]">
                {(['en', 'fr', 'ru'] as Lang[]).map(l => (
                  <div key={l} ref={el => { hiddenChipsRef.current[l] = el }} className="flex flex-wrap gap-1.5">
                    <button className="flex-auto px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap">ALL</button>
                    {CATEGORIES.map(c => (
                      <button key={c.id} className="flex-auto px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap">{c.name[l].toUpperCase()}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className={`mt-4 flex items-center justify-between text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {selectedCategory === null ? (
                <p className={`font-medium ${isDark ? 'text-amber-500/80' : 'text-amber-700'}`}>
                  ⚠ Select a category to save tokens
                </p>
              ) : <span />}
              <span>
                {cacheInfo && <span className="mr-3">cache: {cacheInfo.cached} / {cacheInfo.total} tokens</span>}
                imgs: {processedCount}
              </span>
            </div>
          </div>

          {/* Right: Results and Cube — appears after CLASSIFY is pressed */}
          {hasClassified && (
          <div className="flex-1 min-w-0 flex flex-col space-y-6">
            <div className="flex-grow min-h-[100px]">
              <ResultDisplay
                loadingStage={loadingStage}
                error={error}
                notFound={notFound}
                results={results}
                selectedResultIndex={selectedResultIndex}
                copiedType={copiedType}
                isDark={isDark}
                onCopy={handleCopy}
                onSelectResult={setSelectedResultIndex}
              />
            </div>
            {usedModel === 'gemini-3.1-flash-lite' && (
              <p className="mt-2 text-xs text-center text-amber-500">
                ⚠ Rate limit reached — switched to gemini-3.1-flash-lite
              </p>
            )}
            {selectedResultIndex !== null && results[selectedResultIndex] && (
              <div>
                <PivotCube pivot={results[selectedResultIndex].pivot} uid={results[selectedResultIndex].uid} code={results[selectedResultIndex].type} isDark={isDark} copiedType={copiedType} onCopy={handleCopy} />
              </div>
            )}
          </div>
          )}
        </div>
      </div>
      </div>

      {showKeyGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onClick={() => setShowKeyGuide(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl shadow-xl p-6 ${isDark ? 'bg-[#333333] text-gray-200' : 'bg-white text-gray-800'}`}
          >
            <h2 className="text-lg font-bold mb-2">One quick step before we start</h2>
            <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              This tool uses Google's Gemini AI to recognize objects in photos. To use it, you need a free personal access key — think of it like a password that lets this tool use Google's AI on your behalf. It takes about a minute to get one, and it's free.
            </p>
            <ol className={`text-sm mb-4 space-y-2 list-decimal list-inside ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              <li>
                Open{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  aistudio.google.com/apikey
                </a>
              </li>
              <li>Sign in with your Google account (or create one, it's free)</li>
              <li>Click "Create API key"</li>
              <li>Copy the key and paste it below</li>
            </ol>
            <form
              onSubmit={e => {
                e.preventDefault()
                if (!guideKeyInput.trim()) return
                onAddKey(guideKeyInput.trim())
                setGuideKeyInput('')
                setShowKeyGuide(false)
              }}
            >
              <input
                type="password"
                value={guideKeyInput}
                onChange={e => setGuideKeyInput(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                className={`w-full border rounded-lg px-4 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm ${isDark ? 'bg-[#444] border-gray-600 text-gray-100 placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900'}`}
              />
              <button
                type="submit"
                disabled={!guideKeyInput.trim()}
                className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Save and continue
              </button>
            </form>
            <p className={`text-xs mt-3 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Your key is stored locally in your browser only
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
