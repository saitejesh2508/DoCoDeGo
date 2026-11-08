import type { Balance, Bill, BillWithShares, Home, HomeDetails, Member, Share } from './types'

type PaymentResult =
  | { kind: 'paid'; share: Share }
  | { kind: 'bill-not-found' }
  | { kind: 'share-not-found' }
  | { kind: 'conflict' }

type HomeRow = { id: string; name: string }
type MemberRow = { id: string; home_id: string; name: string }
type ShareRow = {
  id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}
type BillShareRow = {
  bill_id: string
  home_id: string
  title: string
  total_cents: number
  share_id: string | null
  member_id: string | null
  member_name: string | null
  amount_cents: number | null
  paid_at: string | null
}
type BalanceRow = { member_id: string; name: string; outstanding_cents: number }

export async function createHome(db: D1Database, name: string): Promise<Home> {
  const home = { id: crypto.randomUUID(), name }
  await db
    .prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(home.id, home.name, new Date().toISOString())
    .run()
  return home
}

export async function getHome(db: D1Database, homeId: string): Promise<HomeDetails | null> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) return null

  const members = await db
    .prepare('SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY position ASC')
    .bind(homeId)
    .all<MemberRow>()

  return {
    ...home,
    members: members.results.map((member) => ({
      id: member.id,
      homeId: member.home_id,
      name: member.name,
    })),
  }
}

export async function addMember(
  db: D1Database,
  homeId: string,
  name: string,
): Promise<Member | null> {
  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return null

  const member = { id: crypto.randomUUID(), homeId, name }
  await db
    .prepare(
      `INSERT INTO members (id, home_id, name, position, created_at)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM members WHERE home_id = ?), ?)`,
    )
    .bind(member.id, homeId, name, homeId, new Date().toISOString())
    .run()
  return member
}

export async function createBill(
  db: D1Database,
  homeId: string,
  title: string,
  totalCents: number,
): Promise<{ kind: 'created'; bill: Bill } | { kind: 'home-not-found' } | { kind: 'no-members' }> {
  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return { kind: 'home-not-found' }

  const members = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY position ASC')
    .bind(homeId)
    .all<{ id: string }>()
  if (members.results.length === 0) return { kind: 'no-members' }

  const billId = crypto.randomUUID()
  const statements = [
    db
      .prepare(
        `INSERT INTO bills (id, home_id, title, total_cents, position, created_at)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM bills WHERE home_id = ?), ?)`,
      )
      .bind(billId, homeId, title, totalCents, homeId, new Date().toISOString()),
  ]

  const baseCents = Math.floor(totalCents / members.results.length)
  const remainderCents = totalCents % members.results.length
  const shares = members.results.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseCents + (index < remainderCents ? 1 : 0),
    paidAt: null,
  }))

  for (const share of shares) {
    statements.push(
      db
        .prepare('INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(share.id, billId, share.memberId, share.amountCents),
    )
  }

  await db.batch(statements)
  return {
    kind: 'created',
    bill: { id: billId, homeId, title, totalCents, shares },
  }
}

export async function getBills(db: D1Database, homeId: string): Promise<BillWithShares[] | null> {
  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return null

  const result = await db
    .prepare(
      `SELECT b.id AS bill_id, b.home_id, b.title, b.total_cents,
              s.id AS share_id, s.member_id, m.name AS member_name,
              s.amount_cents, s.paid_at
       FROM bills b
       LEFT JOIN shares s ON s.bill_id = b.id
       LEFT JOIN members m ON m.id = s.member_id
       WHERE b.home_id = ?
       ORDER BY b.position ASC, m.position ASC`,
    )
    .bind(homeId)
    .all<BillShareRow>()

  const bills = new Map<string, BillWithShares>()
  for (const row of result.results) {
    let bill = bills.get(row.bill_id)
    if (!bill) {
      bill = {
        id: row.bill_id,
        homeId: row.home_id,
        title: row.title,
        totalCents: row.total_cents,
        shares: [],
      }
      bills.set(row.bill_id, bill)
    }
    if (row.share_id !== null && row.member_id !== null && row.amount_cents !== null) {
      bill.shares.push({
        id: row.share_id,
        memberId: row.member_id,
        memberName: row.member_name,
        amountCents: row.amount_cents,
        paidAt: row.paid_at,
      })
    }
  }
  return Array.from(bills.values())
}

export async function payShare(
  db: D1Database,
  billId: string,
  shareId: string,
  idempotencyKey: string,
): Promise<PaymentResult> {
  const bill = await db.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) return { kind: 'bill-not-found' }

  const paidAt = new Date().toISOString()
  const update = await db
    .prepare(
      `UPDATE shares
       SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM shares WHERE idempotency_key = ?)`,
    )
    .bind(paidAt, idempotencyKey, shareId, billId, idempotencyKey)
    .run()

  if (update.meta.changes === 1) {
    const paidShare = await db
      .prepare(
        'SELECT id, member_id, amount_cents, paid_at FROM shares WHERE id = ? AND bill_id = ?',
      )
      .bind(shareId, billId)
      .first<Pick<ShareRow, 'id' | 'member_id' | 'amount_cents' | 'paid_at'>>()
    if (!paidShare?.paid_at) return { kind: 'share-not-found' }
    return {
      kind: 'paid',
      share: {
        id: paidShare.id,
        memberId: paidShare.member_id,
        amountCents: paidShare.amount_cents,
        paidAt: paidShare.paid_at,
      },
    }
  }

  const existingShare = await db
    .prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (!existingShare) return { kind: 'share-not-found' }
  if (existingShare.paid_at && existingShare.idempotency_key === idempotencyKey) {
    return {
      kind: 'paid',
      share: {
        id: existingShare.id,
        memberId: existingShare.member_id,
        amountCents: existingShare.amount_cents,
        paidAt: existingShare.paid_at,
      },
    }
  }
  return { kind: 'conflict' }
}

export async function getBalances(db: D1Database, homeId: string): Promise<Balance[] | null> {
  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return null

  const result = await db
    .prepare(
      `SELECT m.id AS member_id, m.name,
              COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0)
                AS outstanding_cents
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id
       WHERE m.home_id = ?
       GROUP BY m.id, m.name, m.position
       ORDER BY m.position ASC`,
    )
    .bind(homeId)
    .all<BalanceRow>()

  return result.results.map((balance) => ({
    memberId: balance.member_id,
    name: balance.name,
    outstandingCents: balance.outstanding_cents,
  }))
}
