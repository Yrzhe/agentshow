const NON_ALPHANUMERIC = /[^A-Za-z0-9]/g

export function cwdToSlug(cwd: string): string {
  return cwd.replace(NON_ALPHANUMERIC, '-')
}
