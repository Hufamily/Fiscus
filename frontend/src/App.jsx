import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const response = await fetch('/api/onboarding-overview')
        if (!response.ok) {
          throw new Error('Unable to load onboarding overview')
        }

        setData(await response.json())
      } catch {
        setError('Could not connect to backend API. Start the Flask backend and retry.')
      }
    }

    loadOverview()
  }, [])

  return (
    <main className="container">
      <h1>Fiscus Onboarding</h1>
      <p>
        A starter interface for nonprofits to collect, file, and summarize financial
        information.
      </p>

      {error && <p className="error">{error}</p>}

      {data && (
        <section>
          <h2>{data.organization}</h2>

          <h3>Recommended Next Steps</h3>
          <ul>
            {data.next_steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>

          <h3>Common Forms</h3>
          <ul>
            {data.forms.map((form) => (
              <li key={form}>{form}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

export default App
