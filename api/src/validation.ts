export type JsonObject = Record<string, unknown>

export async function readJsonObject(request: Request): Promise<JsonObject | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    return body as JsonObject
  } catch {
    return null
  }
}

export function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

export function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
