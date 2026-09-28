export function appRoute(pathname: string, base = '/'): 'test' | 'home' {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  let path = pathname
  if (trimmedBase && (path === trimmedBase || path.startsWith(`${trimmedBase}/`))) {
    path = path.slice(trimmedBase.length) || '/'
  }
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path === '/test' ? 'test' : 'home'
}
