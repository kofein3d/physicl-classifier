import { useState, type FormEvent } from 'react'

interface ApiKeySetupProps {
  isDark: boolean
  onKeySet: (key: string) => void
}

export function ApiKeySetup({ isDark, onKeySet }: ApiKeySetupProps) {
  const [key, setKey] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (key.trim()) onKeySet(key.trim())
  }

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-[#282828]' : 'bg-gray-100'}`}>
      <div className={`p-8 rounded-2xl shadow-xl w-full max-w-md ${isDark ? 'bg-[#333333]' : 'bg-white'}`}>
        <div className="flex items-center justify-between mb-4">
          <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
            Nfinite Category Classifier
          </h1>
        </div>
        <p className={`mb-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          This app requires a Gemini API key to work.
        </p>
        <p className={`mb-6 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Get one for free:{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline"
          >
            aistudio.google.com/apikey
          </a>
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza..."
            autoComplete="off"
            className={`w-full border rounded-lg px-4 py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm ${isDark ? 'bg-[#444] border-gray-600 text-gray-100 placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900'}`}
          />
          <button
            type="submit"
            disabled={!key.trim()}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Save and continue
          </button>
        </form>
        <p className={`text-xs mt-4 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Your key is stored locally in your browser only
        </p>
      </div>
    </div>
  )
}
