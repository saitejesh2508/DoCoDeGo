/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database
  }

  interface GlobalProps {
    mainModule: typeof import('./index')
  }
}
