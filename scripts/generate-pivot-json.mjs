// Тянет карту "код категории → пивот" из ЖИВОГО nfinite (плоский запрос) и пишет
// public/pivot-data.json в формате { "_updated": ISO, "CODE": "PIVOT", ... }.
// Свежий pivot — прямо из источника (nfinite), без лага таблицы.
// Токен: env NFINITE_TOKEN (в CI берётся у Worker'а model-replacer по X-Viser-Key).
// Белый список кодов — из src/categories.ts (новый формат: code: "..."), чтобы отсеять
// служебные/битые узлы nfinite (автокод типа NEP8MBSD, pivotPoint: null).
//
// Запуск: NFINITE_TOKEN=<token> node scripts/generate-pivot-json.mjs public/pivot-data.json
import { writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const GRAPHQL_URL = 'https://my.nfinite.app/api/graphql'
const ORGANIZATION = '5e8c228d1bae80366fd11328'
const PAGE_LIMIT = 200

const token = process.env.NFINITE_TOKEN
if (!token) { console.error('NFINITE_TOKEN not set'); process.exit(1) }
const outPath = process.argv[2]
if (!outPath) { console.error('Usage: node scripts/generate-pivot-json.mjs <output-path>'); process.exit(1) }

// белый список: коды нашего каталога (ITEMS: code: "X")
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const categoriesSrc = readFileSync(path.join(__dirname, '..', 'src', 'categories.ts'), 'utf-8')
const knownCodes = new Set([...categoriesSrc.matchAll(/\bcode: "([^"]+)"/g)].map(m => m[1]))
console.log(`Известных кодов в categories.ts: ${knownCodes.size}`)

const QUERY = `query Q($skip: Int) {
  paginatedCategories(paging: { limit: ${PAGE_LIMIT}, skip: $skip }) {
    items { code pivotPoint }
    paging { hasNext }
  }
}`

async function fetchPage(skip) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'hub-organization': ORGANIZATION,
      'apollographql-client-name': 'tree-manager',
      'cookie': `hubstairs-auth=${token}`,
    },
    body: JSON.stringify({ query: QUERY, variables: { skip } }),
  })
  if (res.status === 401 || res.status === 403) throw new Error('AUTH')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error('GraphQL: ' + json.errors.map(e => e.message).join('; '))
  return json.data.paginatedCategories
}

async function main() {
  const map = {}
  let skip = 0, pages = 0
  while (true) {
    const page = await fetchPage(skip)
    pages++
    for (const it of page.items) {
      const code = (it.code || '').trim()
      if (!code || code.startsWith('$') || !knownCodes.has(code)) continue
      if (!(code in map)) map[code] = it.pivotPoint ?? null   // при дублях первый выигрывает
    }
    process.stdout.write(`\r  pages: ${pages}, codes: ${Object.keys(map).length}   `)
    if (!page.paging.hasNext) break
    skip += PAGE_LIMIT
  }
  process.stdout.write('\n')

  const output = { _updated: new Date().toISOString(), ...map }
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`Written ${Object.keys(map).length} categories to ${outPath}`)
}

main().catch(e => { console.error(e.message === 'AUTH' ? 'Token invalid or expired' : 'Error: ' + e.message); process.exit(1) })
