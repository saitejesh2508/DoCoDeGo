import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  addMember,
  createBill,
  createHome,
  getBalances,
  getBills,
  getHome,
  payShare,
} from './repository'
import { errorResponse } from './response'
import { normalizedText, positiveSafeInteger, readJsonObject } from './validation'

const app = new Hono<{ Bindings: Env }>()

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key'],
  }),
)

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await readJsonObject(c.req.raw)
  const name = normalizedText(body?.name)
  if (!name) return errorResponse(c, 422, 'Name must be a non-empty string')
  return c.json(await createHome(c.env.DB, name), 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const home = await getHome(c.env.DB, c.req.param('homeId'))
  if (!home) return errorResponse(c, 404, 'Home not found')
  return c.json(home)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const body = await readJsonObject(c.req.raw)
  const name = normalizedText(body?.name)
  if (!name) return errorResponse(c, 422, 'Name must be a non-empty string')

  const member = await addMember(c.env.DB, c.req.param('homeId'), name)
  if (!member) return errorResponse(c, 404, 'Home not found')
  return c.json(member, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const body = await readJsonObject(c.req.raw)
  const title = normalizedText(body?.title)
  const totalCents = body?.totalCents
  if (!title || !positiveSafeInteger(totalCents)) {
    return errorResponse(
      c,
      422,
      'Title must be non-empty and totalCents must be a positive whole number',
    )
  }

  const result = await createBill(c.env.DB, c.req.param('homeId'), title, totalCents)
  if (result.kind === 'home-not-found') return errorResponse(c, 404, 'Home not found')
  if (result.kind === 'no-members') {
    return errorResponse(c, 422, 'Add at least one member before creating a bill')
  }
  return c.json(result.bill, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const bills = await getBills(c.env.DB, c.req.param('homeId'))
  if (!bills) return errorResponse(c, 404, 'Home not found')
  return c.json({ bills })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return errorResponse(c, 400, 'A valid Idempotency-Key header is required')
  }

  const result = await payShare(
    c.env.DB,
    c.req.param('billId'),
    c.req.param('shareId'),
    idempotencyKey,
  )
  if (result.kind === 'bill-not-found') return errorResponse(c, 404, 'Bill not found')
  if (result.kind === 'share-not-found') return errorResponse(c, 404, 'Share not found')
  if (result.kind === 'conflict') {
    return errorResponse(c, 409, 'Share is already paid or the idempotency key was already used')
  }
  return c.json(result.share)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const balances = await getBalances(c.env.DB, c.req.param('homeId'))
  if (!balances) return errorResponse(c, 404, 'Home not found')
  return c.json({ balances })
})

app.notFound((c) => errorResponse(c, 404, 'Not found'))
app.onError((error, c) => {
  console.error('Unhandled API error', error)
  return errorResponse(c, 500, 'Internal server error')
})

export default app
