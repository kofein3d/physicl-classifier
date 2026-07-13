import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

function loadKeys(): string[] {
  try {
    const stored = localStorage.getItem('gemini-api-keys')
    if (stored) return JSON.parse(stored)
  } catch {}
  // migrate old single key
  const old = localStorage.getItem('gemini-api-key')
  if (old) { saveKeys([old]); return [old] }
  return []
}

function saveKeys(keys: string[]) {
  localStorage.setItem('gemini-api-keys', JSON.stringify(keys))
}

function Root() {
  const [apiKeys, setApiKeys] = useState<string[]>(loadKeys)
  const isDark = true

  const addKey = (key: string) => {
    const next = [...apiKeys, key]
    setApiKeys(next)
    saveKeys(next)
  }

  const removeKey = (index: number) => {
    const next = apiKeys.filter((_, i) => i !== index)
    setApiKeys(next)
    saveKeys(next)
  }

  return (
    <App
      apiKeys={apiKeys}
      isDark={isDark}
      onAddKey={addKey}
      onRemoveKey={removeKey}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)
