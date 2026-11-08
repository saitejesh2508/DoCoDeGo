import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Balance, Bill, Home, Share } from '../src/api'

const apiMocks = vi.hoisted(() => ({
  getHome: vi.fn(),
  getBills: vi.fn(),
  getBalances: vi.fn(),
  createHome: vi.fn(),
  addMember: vi.fn(),
  createBill: vi.fn(),
  payShare: vi.fn(),
}))

vi.mock('../src/api', () => ({ api: apiMocks }))

import { Dashboard } from '../src/routes/index'

const home: Home = {
  id: 'home-1',
  name: 'Test home',
  members: [{ id: 'member-1', homeId: 'home-1', name: 'Asha' }],
}
const unpaidShare: Share = {
  id: 'share-1',
  memberId: 'member-1',
  memberName: 'Asha',
  amountCents: 500,
  paidAt: null,
}
const unpaidBill: Bill = {
  id: 'bill-1',
  homeId: home.id,
  title: 'Electricity',
  totalCents: 500,
  shares: [unpaidShare],
}
const balances: Balance[] = [{ memberId: 'member-1', name: 'Asha', outstandingCents: 500 }]
const paidShare: Share = { ...unpaidShare, paidAt: '2026-11-08T10:00:00.000Z' }
const emptyHome: Home = { ...home, members: [] }

function openHome() {
  fireEvent.change(screen.getByLabelText('Home ID'), { target: { value: home.id } })
  fireEvent.click(screen.getByRole('button', { name: 'Open home' }))
}

function mockLoadedHome(bills: Bill[] = [unpaidBill]) {
  apiMocks.getHome.mockResolvedValue(home)
  apiMocks.getBills.mockResolvedValue(bills)
  apiMocks.getBalances.mockResolvedValue(balances)
}

beforeEach(() => {
  window.localStorage.clear()
  for (const mock of Object.values(apiMocks)) mock.mockReset()
})
afterEach(cleanup)

describe('shared home dashboard', () => {
  it('shows loading and empty states while home data loads', async () => {
    mockLoadedHome([])
    apiMocks.getHome.mockResolvedValue(emptyHome)
    let resolveHome: ((value: Home) => void) | undefined
    apiMocks.getHome.mockReturnValue(
      new Promise<Home>((resolve) => {
        resolveHome = resolve
      }),
    )

    render(<Dashboard />)
    openHome()
    expect(screen.getByText('Loading your home')).toBeTruthy()
    await act(async () => resolveHome?.(emptyHome))

    expect(await screen.findByText('No members yet')).toBeTruthy()
    expect(screen.getByText('No bills to split yet')).toBeTruthy()
  })

  it.each([
    ['404', 'Home not found'],
    ['500', 'Internal server error'],
  ])('shows a useful error when the API returns %s', async (_status, message) => {
    apiMocks.getHome.mockRejectedValue(new Error(message))
    apiMocks.getBills.mockResolvedValue([])
    apiMocks.getBalances.mockResolvedValue([])

    render(<Dashboard />)
    openHome()

    expect(await screen.findByText('We couldn’t open this home')).toBeTruthy()
    expect(screen.getByText(message)).toBeTruthy()
  })

  it('keeps a failed payment unpaid and reuses its key when retried', async () => {
    mockLoadedHome()
    apiMocks.payShare
      .mockRejectedValueOnce(new Error('Payment could not be completed'))
      .mockResolvedValueOnce(paidShare)
    render(<Dashboard />)
    openHome()

    const payButton = await screen.findByRole('button', { name: 'Pay share' })
    fireEvent.click(payButton)
    expect(await screen.findByText('Payment could not be completed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pay share' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Pay share' }))
    await screen.findByText('Paid', { exact: true })
    expect(apiMocks.payShare).toHaveBeenCalledTimes(2)
    expect(apiMocks.payShare.mock.calls[1]).toEqual(apiMocks.payShare.mock.calls[0])
  })

  it('prevents repeated clicks while a payment request is pending', async () => {
    mockLoadedHome()
    let resolvePayment: ((value: Share) => void) | undefined
    apiMocks.payShare.mockReturnValue(
      new Promise<Share>((resolve) => {
        resolvePayment = resolve
      }),
    )
    render(<Dashboard />)
    openHome()

    const payButton = await screen.findByRole('button', { name: 'Pay share' })
    fireEvent.click(payButton)
    await waitFor(() => expect(payButton.hasAttribute('disabled')).toBe(true))
    fireEvent.click(payButton)
    expect(apiMocks.payShare).toHaveBeenCalledTimes(1)

    apiMocks.getBills.mockResolvedValue([{ ...unpaidBill, shares: [paidShare] }])
    await act(async () => resolvePayment?.(paidShare))
    expect(await screen.findByText('Paid', { exact: true })).toBeTruthy()
  })
})
