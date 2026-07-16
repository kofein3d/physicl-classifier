import React, { useState, useEffect } from 'react'
import { ITEMS } from './categories'
import { PivotCube } from './PivotCube'

// code -> UID (постоянная часть, не зависит от pivot-data.json)
const CODE_TO_UID = new Map(ITEMS.map(it => [it.code, it.uid]))
// code -> поисковые названия (EN/RU/FR) для нижнего блока под кубом
const CODE_TO_SEARCH = new Map(ITEMS.map(it => [it.code, it.search]))

type Lang = 'en' | 'ru' | 'fr'

interface Entry { type: string; pivot: string; uid: string }

// --- PAGE ---

interface PivotPageProps {
  isDark: boolean
}

export function PivotPage({ isDark }: PivotPageProps) {
  // Начальные данные — статический ITEMS (мгновенно, с UID). При загрузке страницы
  // тихо обновляется pivot из pivot-data.json (генерируется GitHub Actions); UID берём
  // из ITEMS всегда, т.к. в pivot-data.json его нет.
  const [entries, setEntries] = useState<Entry[]>(ITEMS.map(it => ({ type: it.code, pivot: it.pivot, uid: it.uid })))
  const [dataStale, setDataStale] = useState(false)

  useEffect(() => {
    // cache-busting (?t=…) + no-store: обходим кеш браузера И CDN GitHub Pages,
    // иначе пользователь видит старый pivot до 10 мин и без Ctrl+F5 не обновит.
    fetch('./pivot-data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then((map: Record<string, string | null>) => {
        const { _updated, ...rest } = map as Record<string, string | null>
        const items = Object.entries(rest)
        if (items.length > 0)
          setEntries(items.map(([type, pivot]) => ({ type, pivot: pivot ?? 'null', uid: CODE_TO_UID.get(type) ?? '' })))
        // Данные считаем устаревшими если обновлялись более 25 часов назад
        if (_updated) {
          const ageMs = Date.now() - new Date(_updated).getTime()
          if (ageMs > 25 * 60 * 60 * 1000) setDataStale(true)
        } else {
          setDataStale(true)
        }
      })
      .catch(() => setDataStale(true))
  }, [])

  // Два независимых поля: CODE и UID. Если CODE заполнен — ищем по нему (приоритет).
  // Если CODE пуст, а UID заполнен — ищем по UID и подставляем найденный код в поле CODE.
  const [codeText, setCodeText] = useState('')
  const [uidText, setUidText] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [lang, setLang] = useState<Lang>('en')

  const codeQuery = codeText.trim().toUpperCase()
  const resolvedByCode = codeQuery ? entries.find(e => e.type === codeQuery) : undefined
  const resolvedByUid = (!codeQuery && uidText) ? entries.find(e => e.uid === uidText) : undefined
  const exactEntry = resolvedByCode ?? resolvedByUid

  const suggestions = codeQuery.length >= 1
    ? entries.filter(e => e.type.includes(codeQuery) && e.type !== codeQuery)
    : []

  useEffect(() => { setHighlighted(0) }, [codeText])

  const selectCode = (type: string) => { setCodeText(type); setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); selectCode(suggestions[highlighted].type) }
    else if (e.key === 'Escape') setOpen(false)
  }

  // Отображаемые значения полей: то, что реально набрано, либо (если поле не ведущее) — резолв с другой стороны
  const codeFieldValue = codeText || (resolvedByUid?.type ?? '')
  const uidFieldValue = codeQuery ? (resolvedByCode?.uid ?? '') : uidText

  // Последний найденный предмет — держим и при схлопывании (не размонтируем сразу),
  // иначе анимация "высота карточки от низкой к высокой и обратно" не успевает сыграть.
  const [lastEntry, setLastEntry] = useState<Entry | null>(null)
  useEffect(() => { if (exactEntry) setLastEntry(exactEntry) }, [exactEntry])
  const cubeVisible = !!(exactEntry && !open)

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-[#282828]' : 'bg-gray-100'}`}>
      <div className={`p-6 rounded-2xl shadow-xl w-full max-w-[720px] ${isDark ? 'bg-[#333333]' : 'bg-white'}`}>
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-2xl font-bold flex items-center gap-2 ${isDark ? '' : 'text-gray-800'}`} style={isDark ? { color: '#c8963c' } : undefined}>
            Pivot lookup
            {dataStale && <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block', flexShrink: 0 }} />}
          </h1>
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            {(['en', 'fr', 'ru'] as Lang[]).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-1 text-xs font-bold transition-colors ${
                  lang === l
                    ? (isDark ? 'text-black' : 'bg-blue-600 text-white')
                    : (isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:bg-gray-100')
                }`}
                style={isDark && lang === l ? { backgroundColor: '#c8963c' } : undefined}
              >{l.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="flex gap-2 items-stretch">
            {/* CODE — основной поиск, автодополнение по подстроке */}
            <input
              type="text"
              value={codeFieldValue}
              onChange={e => { setCodeText(e.target.value.toUpperCase()); setUidText(''); setOpen(true) }}
              onFocus={() => { if (codeText.length >= 1 && !resolvedByCode) setOpen(true) }}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKeyDown}
              placeholder="PRODUCT_CATEGORY"
              autoComplete="off"
              autoFocus
              style={{ color: /[^\x00-\x7F]/.test(codeFieldValue) ? '#ef4444' : 'rgb(120, 175, 230)' }}
              className={`flex-1 min-w-0 border rounded-lg px-3 h-[36px] text-lg font-normal font-mono focus:outline-none focus:ring-1 ${
                isDark
                  ? 'bg-[#262626] border-gray-600 placeholder-gray-600 focus:ring-[#c8963c]'
                  : 'bg-[#ebebeb] border-gray-300 placeholder-gray-400 focus:ring-blue-400'
              }`}
            />
            {/* UID — всегда активно; резолвит только когда CODE пуст (см. uidFieldValue) */}
            <input
              type="text"
              inputMode="numeric"
              value={uidFieldValue}
              onChange={e => setUidText(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="UID"
              style={{ color: '#a875cf' }}
              className={`w-24 shrink-0 border rounded-lg px-2 h-[36px] text-lg font-normal font-mono text-center focus:outline-none focus:ring-1 ${
                isDark
                  ? 'bg-[#262626] border-gray-600 placeholder-gray-600 focus:ring-[#c8963c]'
                  : 'bg-[#ebebeb] border-gray-300 placeholder-gray-400 focus:ring-blue-400'
              }`}
            />
            {/* PIVOT — только вывод */}
            <div className={`w-20 shrink-0 border rounded-lg px-3 h-[36px] flex items-center justify-center text-lg font-normal font-mono transition-colors duration-300 ${
              isDark ? 'bg-[#262626] border-gray-600' : 'bg-[#ebebeb] border-gray-300'
            } ${exactEntry ? (isDark ? 'text-[#c8963c]' : 'text-blue-700') : (isDark ? 'text-gray-600' : 'text-gray-400')}`}>
              {exactEntry ? (exactEntry.pivot ?? 'null') : '—'}
            </div>
          </div>

          {open && suggestions.length > 0 && (
            <ul className={`lookup-list absolute z-10 left-0 right-[192px] mt-1 max-h-72 overflow-y-auto overflow-x-hidden rounded-lg border text-sm font-mono ${
              isDark ? 'bg-[#262626] border-gray-700 text-gray-200' : 'bg-[#ebebeb] border-gray-300 text-gray-800'
            }`}>
              {suggestions.map((s, i) => (
                <li
                  key={s.type}
                  onMouseDown={() => selectCode(s.type)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`px-3 py-px cursor-pointer flex justify-between items-center transition-colors duration-100 ${
                    i === highlighted
                      ? isDark ? 'bg-[#323232]' : 'bg-[#d8d8d8]'
                      : ''
                  }`}
                >
                  <span className="text-lg font-normal min-w-0 truncate" style={{ color: 'rgb(120, 175, 230)' }}>{s.type}</span>
                  <span className={`text-lg font-normal ml-2 shrink-0 ${isDark ? 'text-[#c8963c]' : 'text-blue-600'}`}>{s.pivot}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Высота карточки анимируется через grid-template-rows 0fr<->1fr (единственный чистый
            CSS-способ анимировать "высоту от auto"). Контент не размонтируем сразу при схлопывании
            (lastEntry), иначе анимация схлопывания не успевает сыграть. */}
        <div style={{ display: 'grid', gridTemplateRows: cubeVisible ? '1fr' : '0fr', transition: 'grid-template-rows 0.35s ease' }}>
          <div style={{ overflow: 'hidden' }}>
            {lastEntry && (
              <div key={lastEntry.type} className={cubeVisible ? 'cube-appear' : ''}>
                <PivotCube pivot={lastEntry.pivot} isDark={isDark} searchText={CODE_TO_SEARCH.get(lastEntry.type)?.[lang] ?? ''} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
