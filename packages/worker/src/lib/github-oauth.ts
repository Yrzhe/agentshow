export interface GitHubUser {
  id: number
  login: string
  avatar_url: string
  email: string | null
}

export interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`)
  }

  const payload = await response.json() as { access_token?: string }
  if (!payload.access_token) {
    throw new Error('GitHub token exchange did not return access_token')
  }

  return payload.access_token
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'AgentShow Worker',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed: ${response.status}`)
  }

  const user = await response.json() as GitHubUser

  if (!user.email) {
    user.email = await fetchPrimaryEmail(accessToken)
  }

  return user
}

async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'AgentShow Worker',
    },
  })

  if (!response.ok) {
    return null
  }

  const emails = await response.json() as GitHubEmail[]
  const primary = emails.find((e) => e.primary && e.verified)
  return primary?.email ?? emails.find((e) => e.verified)?.email ?? null
}
