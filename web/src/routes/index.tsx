import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { api, type Balance, type Bill, type Home } from '../api'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function savedHomeId(): string {
  try {
    return window.localStorage.getItem('bill-splitter-home') ?? ''
  } catch {
    return ''
  }
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function Dashboard() {
  const [homeSelection, setHomeSelection] = useState(() => ({
    id: savedHomeId(),
    revision: 0,
  }))
  const homeId = homeSelection.id
  const [homeInput, setHomeInput] = useState(homeId)
  const [home, setHome] = useState<Home | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    homeId ? 'loading' : 'idle',
  )
  const [loadError, setLoadError] = useState('')
  const [showCreateHome, setShowCreateHome] = useState(!homeId)
  const [creatingHome, setCreatingHome] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [creatingBill, setCreatingBill] = useState(false)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})
  const paymentKeys = useRef(new Map<string, string>())

  useEffect(() => {
    try {
      if (homeId) window.localStorage.setItem('bill-splitter-home', homeId)
      else window.localStorage.removeItem('bill-splitter-home')
    } catch {
      setLoadError('Your browser could not save this home on this device.')
    }
  }, [homeId])

  useEffect(() => {
    const requestedHomeId = homeSelection.id
    if (!requestedHomeId) {
      setHome(null)
      setBills([])
      setBalances([])
      setLoadState('idle')
      return
    }

    const controller = new AbortController()
    setLoadState('loading')
    setLoadError('')
    void Promise.all([
      api.getHome(requestedHomeId, controller.signal),
      api.getBills(requestedHomeId, controller.signal),
      api.getBalances(requestedHomeId, controller.signal),
    ])
      .then(([loadedHome, loadedBills, loadedBalances]) => {
        setHome(loadedHome)
        setBills(loadedBills)
        setBalances(loadedBalances)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setHome(null)
        setBills([])
        setBalances([])
        setLoadError(errorMessage(error))
        setLoadState('error')
      })
    return () => controller.abort()
  }, [homeSelection])

  function openHome(id: string) {
    setShowCreateHome(false)
    setHomeSelection((current) => ({ id, revision: current.revision + 1 }))
  }

  function chooseHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError('')
    setActionSuccess('')
    const nextHomeId = homeInput.trim()
    if (!nextHomeId) {
      setActionError('Enter a home ID to open it.')
      return
    }
    openHome(nextHomeId)
  }

  async function createHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('homeName') ?? '').trim()
    setCreatingHome(true)
    setActionError('')
    try {
      const created = await api.createHome(name)
      openHome(created.id)
      setHomeInput(created.id)
      setShowCreateHome(false)
      setActionSuccess(`“${created.name}” is ready. Add household members to get started.`)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setCreatingHome(false)
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return
    const form = event.currentTarget
    const name = String(new FormData(form).get('memberName') ?? '').trim()
    setAddingMember(true)
    setActionError('')
    setActionSuccess('')
    try {
      await api.addMember(home.id, name)
      form.reset()
      setActionSuccess(`${name} was added to ${home.name}.`)
      openHome(home.id)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setAddingMember(false)
    }
  }

  async function createBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return
    const form = event.currentTarget
    const values = new FormData(form)
    const title = String(values.get('billTitle') ?? '').trim()
    const dollars = Number(values.get('billAmount'))
    const totalCents = Math.round(dollars * 100)
    setCreatingBill(true)
    setActionError('')
    setActionSuccess('')
    try {
      await api.createBill(home.id, title, totalCents)
      form.reset()
      setActionSuccess(`${title} was added and split between the household.`)
      openHome(home.id)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setCreatingBill(false)
    }
  }

  async function payShare(billId: string, shareId: string) {
    const key = paymentKeys.current.get(shareId) ?? crypto.randomUUID()
    paymentKeys.current.set(shareId, key)
    setPayingShareId(shareId)
    setPaymentErrors((errors) => ({ ...errors, [shareId]: '' }))
    setActionSuccess('')
    try {
      const paidShare = await api.payShare(billId, shareId, key)
      paymentKeys.current.delete(shareId)
      setBills((current) =>
        current.map((bill) =>
          bill.id === billId
            ? {
                ...bill,
                shares: bill.shares.map((share) =>
                  share.id === shareId ? { ...share, paidAt: paidShare.paidAt } : share,
                ),
              }
            : bill,
        ),
      )
      setActionSuccess('Payment confirmed.')
      openHome(home?.id ?? '')
    } catch (error) {
      setPaymentErrors((errors) => ({ ...errors, [shareId]: errorMessage(error) }))
    } finally {
      setPayingShareId(null)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Shared home dashboard">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>
            Shared<span className="brand-light">space</span>
          </span>
        </a>
        <form className="home-switcher" onSubmit={chooseHome}>
          <label className="visually-hidden" htmlFor="home-id">
            Home ID
          </label>
          <input
            id="home-id"
            value={homeInput}
            onChange={(event) => setHomeInput(event.target.value)}
            placeholder="Paste a home ID"
            autoComplete="off"
          />
          <button className="button button-outline" type="submit">
            Open home
          </button>
        </form>
        <button
          className="button button-primary topbar-create"
          type="button"
          onClick={() => setShowCreateHome((visible) => !visible)}
        >
          + New home
        </button>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">HOUSEHOLD FINANCES</p>
          <h1>{home?.name ?? 'A clearer way to share bills'}</h1>
          <p className="subtitle">
            Keep household expenses organized and settle up one share at a time.
          </p>
        </div>
        {home && (
          <div className="home-badge">
            <span className="online-dot" />
            <span>Home active</span>
            <code title={home.id}>{home.id.slice(0, 8)}…</code>
          </div>
        )}
      </section>

      {(showCreateHome || !homeId) && (
        <section className="card create-home-card">
          <div>
            <span className="section-icon lilac">⌂</span>
            <h2>Create a home</h2>
            <p>Start a shared space for the people you live with.</p>
          </div>
          <form className="inline-form" onSubmit={createHome}>
            <label className="visually-hidden" htmlFor="home-name">
              Home name
            </label>
            <input id="home-name" name="homeName" placeholder="e.g. Maple Street" required />
            <button type="submit" className="button button-primary" disabled={creatingHome}>
              {creatingHome ? 'Creating…' : 'Create home'}
            </button>
          </form>
        </section>
      )}

      {actionError && (
        <p className="notice notice-error" role="alert">
          {actionError}
        </p>
      )}
      {actionSuccess && (
        <p className="notice notice-success" role="status">
          {actionSuccess}
        </p>
      )}

      {!homeId ? (
        <section className="welcome-empty card">
          <div className="empty-illustration" aria-hidden="true">
            ↗
          </div>
          <h2>Your household, all squared away.</h2>
          <p>Create a home above or open one with its home ID to see members and bills.</p>
        </section>
      ) : loadState === 'loading' ? (
        <section className="card loading-card" role="status">
          <span className="spinner" />
          <div>
            <h2>Loading your home</h2>
            <p>Getting members, bills, and balances…</p>
          </div>
        </section>
      ) : loadState === 'error' ? (
        <section className="card error-card" role="alert">
          <span className="error-symbol">!</span>
          <div>
            <h2>We couldn’t open this home</h2>
            <p>{loadError}</p>
          </div>
          <button type="button" className="button button-outline" onClick={() => openHome(homeId)}>
            Try again
          </button>
        </section>
      ) : home ? (
        <div className="dashboard-grid">
          <section className="main-column">
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR HOUSEHOLD</p>
                <h2>Members & balances</h2>
              </div>
              <span className="count-pill">
                {home.members.length} {home.members.length === 1 ? 'member' : 'members'}
              </span>
            </div>
            <section className="card members-card">
              {home.members.length === 0 ? (
                <div className="compact-empty">
                  <span className="section-icon lilac">♧</span>
                  <div>
                    <h3>No members yet</h3>
                    <p>Add your household to start splitting bills.</p>
                  </div>
                </div>
              ) : (
                <div className="member-list">
                  {home.members.map((member, index) => {
                    const balance = balances.find((item) => item.memberId === member.id)
                    return (
                      <div className="member-row" key={member.id}>
                        <span className={`avatar avatar-${index % 5}`}>
                          {member.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="member-name">{member.name}</span>
                        <span className="member-balance">
                          {money(balance?.outstandingCents ?? 0)}
                          <small> outstanding</small>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <form className="member-form" onSubmit={addMember}>
                <label className="visually-hidden" htmlFor="member-name">
                  Member name
                </label>
                <input
                  id="member-name"
                  name="memberName"
                  placeholder="Add a household member"
                  required
                />
                <button type="submit" className="button button-outline" disabled={addingMember}>
                  {addingMember ? 'Adding…' : 'Add member'}
                </button>
              </form>
            </section>

            <div className="section-heading bill-heading">
              <div>
                <p className="eyebrow">SHARED EXPENSES</p>
                <h2>Recent bills</h2>
              </div>
              <span className="count-pill">
                {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
              </span>
            </div>

            {bills.length === 0 ? (
              <section className="card bills-empty">
                <span className="section-icon peach">↗</span>
                <h3>No bills to split yet</h3>
                <p>Add your first household expense using the form alongside.</p>
              </section>
            ) : (
              <div className="bill-list">
                {bills.map((bill) => (
                  <article className="card bill-card" key={bill.id}>
                    <div className="bill-title-row">
                      <span className="bill-icon">↗</span>
                      <div className="bill-name">
                        <h3>{bill.title}</h3>
                        <p>
                          {bill.shares.length} {bill.shares.length === 1 ? 'share' : 'shares'}
                        </p>
                      </div>
                      <strong className="bill-total">{money(bill.totalCents)}</strong>
                    </div>
                    <div className="share-list">
                      {bill.shares.map((share) => {
                        const memberName =
                          share.memberName ??
                          home.members.find((member) => member.id === share.memberId)?.name ??
                          'Household member'
                        const paid = share.paidAt !== null
                        return (
                          <div className="share-row" key={share.id}>
                            <span className="share-person">
                              <span className="small-avatar">
                                {memberName.slice(0, 1).toUpperCase()}
                              </span>
                              {memberName}
                            </span>
                            <strong>{money(share.amountCents)}</strong>
                            {paid ? (
                              <span className="status-paid">Paid</span>
                            ) : (
                              <button
                                type="button"
                                className="button button-pay"
                                disabled={payingShareId !== null}
                                onClick={() => void payShare(bill.id, share.id)}
                              >
                                {payingShareId === share.id ? 'Paying…' : 'Pay share'}
                              </button>
                            )}
                            {paymentErrors[share.id] && (
                              <p className="share-error" role="alert">
                                {paymentErrors[share.id]}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="side-column">
            <section className="card form-card">
              <span className="section-icon lilac">＋</span>
              <h2>Add a bill</h2>
              <p>Split an expense evenly with everyone in your home.</p>
              {home.members.length === 0 ? (
                <p className="form-hint">Add at least one member before creating a bill.</p>
              ) : (
                <form className="stacked-form" onSubmit={createBill}>
                  <label htmlFor="bill-title">Bill name</label>
                  <input id="bill-title" name="billTitle" placeholder="e.g. Electricity" required />
                  <label htmlFor="bill-amount">Total amount</label>
                  <div className="money-input">
                    <span>$</span>
                    <input
                      id="bill-amount"
                      name="billAmount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <p className="form-hint">Extra cents go to members in the order they joined.</p>
                  <button
                    type="submit"
                    className="button button-primary button-full"
                    disabled={creatingBill}
                  >
                    {creatingBill ? 'Splitting bill…' : 'Split this bill'}
                  </button>
                </form>
              )}
            </section>
            <section className="tip-card">
              <span className="tip-sparkle">✦</span>
              <div>
                <h3>Fair by design</h3>
                <p>
                  Every cent is accounted for. When a split doesn’t divide evenly, the first members
                  receive the extra cents.
                </p>
              </div>
            </section>
            <p className="privacy-note">Your household data stays in your shared home space.</p>
          </aside>
        </div>
      ) : null}
      <footer className="footer">
        Sharedspace <span>·</span> Keep the home, keep it fair.
      </footer>
    </main>
  )
}
