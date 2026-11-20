// A JWT-shaped string with the given claims and no real signature. The client never
// verifies signatures (SpacetimeDB does), it only reads `exp`, so this is enough.
export function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}
