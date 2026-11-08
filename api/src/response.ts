import type { Context } from 'hono'

type AppEnvironment = { Bindings: Env }
type ErrorStatus = 400 | 404 | 409 | 422 | 500

export function errorResponse(
  context: Context<AppEnvironment>,
  status: ErrorStatus,
  message: string,
) {
  return context.json({ error: message }, status)
}
