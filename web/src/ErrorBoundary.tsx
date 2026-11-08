import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard rendering failed', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-shell">
          <section className="card error-card" role="alert">
            <span className="error-symbol">!</span>
            <div>
              <h2>This page hit a problem</h2>
              <p>Reload the page to try again. Your saved bills are unchanged.</p>
            </div>
            <button
              type="button"
              className="button button-outline"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
