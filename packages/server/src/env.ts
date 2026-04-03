export type ServerEnv = {
  JWT_SECRET: string
  DATABASE_PATH: string
  PORT: number
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  ALLOWED_EMAILS?: string
  AI_PROVIDER: 'anthropic' | 'openai' | 'disabled'
  AI_API_KEY?: string
  AI_MODEL?: string
}

export function loadEnv(): ServerEnv {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw new Error('JWT_SECRET is required')
  return {
    JWT_SECRET: jwtSecret,
    DATABASE_PATH: process.env.DATABASE_PATH ?? './data/agentshow.db',
    PORT: Number(process.env.PORT ?? 3000),
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ALLOWED_EMAILS: process.env.ALLOWED_EMAILS,
    AI_PROVIDER: (process.env.AI_PROVIDER as ServerEnv['AI_PROVIDER']) ?? 'disabled',
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  }
}
