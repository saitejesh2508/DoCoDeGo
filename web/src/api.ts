export type Member = { id: string; homeId: string; name: string }
export type Home = { id: string; name: string; members: Member[] }
export type HomeSummary = { id: string; name: string; memberCount: number; billCount: number }
export type Share = {
  id: string
  memberId: string
  memberName: string | null
  amountCents: number
  paidAt: string | null
}
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ApiError(`The server returned an invalid ${field}.`)
  return value
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ApiError(`The server returned an invalid ${field}.`)
  }
  return value
}

function parseMember(value: unknown): Member {
  if (!isRecord(value)) throw new ApiError('The server returned an invalid member.')
  return {
    id: requiredString(value.id, 'member ID'),
    homeId: requiredString(value.homeId, 'member home ID'),
    name: requiredString(value.name, 'member name'),
  }
}

function parseHome(value: unknown): Home {
  if (!isRecord(value) || !Array.isArray(value.members)) {
    throw new ApiError('The server returned an invalid home.')
  }
  return {
    id: requiredString(value.id, 'home ID'),
    name: requiredString(value.name, 'home name'),
    members: value.members.map(parseMember),
  }
}

function parseHomeSummary(value: unknown): HomeSummary {
  if (!isRecord(value)) throw new ApiError('The server returned an invalid home.')
  return {
    id: requiredString(value.id, 'home ID'),
    name: requiredString(value.name, 'home name'),
    memberCount: safeInteger(value.memberCount, 'member count'),
    billCount: safeInteger(value.billCount, 'bill count'),
  }
}

function parseShare(value: unknown): Share {
  if (!isRecord(value)) throw new ApiError('The server returned an invalid share.')
  const memberName = value.memberName
  const paidAt = value.paidAt
  if (
    (memberName !== undefined && memberName !== null && typeof memberName !== 'string') ||
    (paidAt !== null && typeof paidAt !== 'string')
  ) {
    throw new ApiError('The server returned invalid share details.')
  }
  return {
    id: requiredString(value.id, 'share ID'),
    memberId: requiredString(value.memberId, 'share member ID'),
    memberName: typeof memberName === 'string' ? memberName : null,
    amountCents: safeInteger(value.amountCents, 'share amount'),
    paidAt,
  }
}

function parseBill(value: unknown): Bill {
  if (!isRecord(value) || !Array.isArray(value.shares)) {
    throw new ApiError('The server returned an invalid bill.')
  }
  return {
    id: requiredString(value.id, 'bill ID'),
    homeId: requiredString(value.homeId, 'bill home ID'),
    title: requiredString(value.title, 'bill title'),
    totalCents: safeInteger(value.totalCents, 'bill total'),
    shares: value.shares.map(parseShare),
  }
}

function parseBalances(value: unknown): Balance[] {
  if (!isRecord(value) || !Array.isArray(value.balances)) {
    throw new ApiError('The server returned invalid balances.')
  }
  return value.balances.map((item) => {
    if (!isRecord(item)) throw new ApiError('The server returned an invalid balance.')
    return {
      memberId: requiredString(item.memberId, 'balance member ID'),
      name: requiredString(item.name, 'balance member name'),
      outstandingCents: safeInteger(item.outstandingCents, 'outstanding balance'),
    }
  })
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController()
  const externalSignal = init.signal
  const abortFromCaller = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromCaller()
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })

  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 15_000)

  try {
    let response: Response
    try {
      response = await fetch(path, { ...init, signal: controller.signal })
    } catch {
      if (timedOut) throw new ApiError('The request timed out. Please try again.')
      if (externalSignal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
      throw new ApiError('Unable to reach the server. Check your connection and try again.')
    }

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : `The request failed (${response.status}).`
      throw new ApiError(message, response.status)
    }
    if (payload === null) throw new ApiError('The server returned an unreadable response.')
    return payload
  } finally {
    window.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
}

function post(path: string, body: unknown): Promise<unknown> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  async getHomes(signal?: AbortSignal): Promise<HomeSummary[]> {
    const result = await request('/api/homes', { signal })
    if (!isRecord(result) || !Array.isArray(result.homes)) {
      throw new ApiError('The server returned an invalid home list.')
    }
    return result.homes.map(parseHomeSummary)
  },

  async getHome(homeId: string, signal?: AbortSignal): Promise<Home> {
    return parseHome(await request(`/api/homes/${encodeURIComponent(homeId)}`, { signal }))
  },

  async getBills(homeId: string, signal?: AbortSignal): Promise<Bill[]> {
    const result = await request(`/api/homes/${encodeURIComponent(homeId)}/bills`, { signal })
    if (!isRecord(result) || !Array.isArray(result.bills)) {
      throw new ApiError('The server returned an invalid bill list.')
    }
    return result.bills.map(parseBill)
  },

  async getBalances(homeId: string, signal?: AbortSignal): Promise<Balance[]> {
    return parseBalances(
      await request(`/api/homes/${encodeURIComponent(homeId)}/balances`, { signal }),
    )
  },

  async createHome(name: string): Promise<{ id: string; name: string }> {
    const result = await post('/api/homes', { name })
    if (!isRecord(result)) throw new ApiError('The server returned an invalid home.')
    return {
      id: requiredString(result.id, 'home ID'),
      name: requiredString(result.name, 'home name'),
    }
  },

  async addMember(homeId: string, name: string): Promise<Member> {
    return parseMember(await post(`/api/homes/${encodeURIComponent(homeId)}/members`, { name }))
  },

  async createBill(homeId: string, title: string, totalCents: number): Promise<Bill> {
    return parseBill(
      await post(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
        title,
        totalCents,
      }),
    )
  },

  async payShare(billId: string, shareId: string, idempotencyKey: string): Promise<Share> {
    const result = await request(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    )
    return parseShare(result)
  },
}
