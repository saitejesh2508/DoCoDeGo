import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Member } from './helpers'

describe('home and bill edge cases', () => {
  it('lists homes by name with member and bill counts', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 501)

    const result = await call<{
      homes: Array<{ id: string; name: string; memberCount: number; billCount: number }>
    }>('GET', '/api/homes')

    expect(result.status).toBe(200)
    expect(result.body.homes).toContainEqual({
      id: homeId,
      name: 'Test home',
      memberCount: 2,
      billCount: 1,
    })
  })

  it('rejects empty names and keeps members in insertion order', async () => {
    const invalid = await call('POST', '/api/homes', { body: { name: '   ' } })
    expect(invalid.status).toBe(422)

    const { homeId, members } = await createHome(['First', 'Second', 'Third'])
    const loaded = await call<{ members: Member[] }>('GET', `/api/homes/${homeId}`)
    expect(loaded.body.members.map((member) => member.id)).toEqual(
      members.map((member) => member.id),
    )
  })

  it('rejects an unsafe integer amount', async () => {
    const { homeId } = await createHome(['One'])
    const result = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title: 'Too large', totalCents: Number.MAX_SAFE_INTEGER + 1 },
    })
    expect(result.status).toBe(422)
  })

  it('lists bills and member names for the dashboard', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    const created = await createBill(homeId, 501)
    const result = await call<{
      bills: Array<{ id: string; shares: Array<{ memberId: string; memberName: string | null }> }>
    }>('GET', `/api/homes/${homeId}/bills`)

    expect(result.status).toBe(200)
    expect(result.body.bills[0]?.id).toBe(created.body.id)
    expect(result.body.bills[0]?.shares.map((share) => share.memberId)).toEqual(
      members.map((member) => member.id),
    )
    expect(result.body.bills[0]?.shares.map((share) => share.memberName)).toEqual(['Asha', 'Ben'])
  })

  it('does not allow paying a share through a different bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const first = await createBill(homeId, 100)
    const second = await createBill(homeId, 200)
    const firstShare = first.body.shares[0]
    const secondShare = second.body.shares[0]
    if (!firstShare || !secondShare) throw new Error('bill shares were not created')

    const result = await call('POST', `/api/bills/${first.body.id}/shares/${secondShare.id}/pay`, {
      headers: { 'Idempotency-Key': 'wrong-bill' },
    })
    expect(result.status).toBe(404)
  })

  it('allows only one of two concurrent payments with different keys', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 100)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill share was not created')

    const results = await Promise.all([
      call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'concurrent-first' },
      }),
      call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'concurrent-second' },
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const balance = await call<{ balances: Array<{ outstandingCents: number }> }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )
    expect(balance.body.balances[0]?.outstandingCents).toBe(0)
  })

  it('returns the original result for concurrent retries with the same key', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 100)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill share was not created')
    const path = `/api/bills/${bill.body.id}/shares/${share.id}/pay`

    const results = await Promise.all([
      call<{ paidAt: string }>('POST', path, { headers: { 'Idempotency-Key': 'same-retry-key' } }),
      call<{ paidAt: string }>('POST', path, { headers: { 'Idempotency-Key': 'same-retry-key' } }),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]?.body.paidAt).toBe(results[1]?.body.paidAt)
  })
})
