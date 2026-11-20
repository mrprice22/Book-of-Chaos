/**
 * A minimal OIDC issuer, run inside the test process: discovery, JWKS, and signed
 * ID tokens minted on request. It stands in for SpacetimeAuth's login page, which no
 * test can click through. It is the M14.2 spike's `issuer.mjs`, with `email_verified`
 * added, because that claim is what makes a caller signed in (server/src/signin.rs).
 *
 * SpacetimeDB fetches `<iss>/.well-known/openid-configuration` and the JWKS it names
 * when a token arrives, so the issuer has to be listening before a token is used.
 * Which issuer the module *trusts* is fixed when it is built: `deploy.sh local` trusts
 * `http://127.0.0.1:3200` for client `boc-e2e`.
 */
import { createServer, type Server } from 'node:http';
import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MintOptions {
  readonly sub: string;
  readonly aud: string;
  /** Leave the claim out entirely when `undefined`, as SpacetimeAuth's anonymous login does. */
  readonly emailVerified?: boolean;
}

export interface MockIssuer {
  readonly issuer: string;
  mint(options: MintOptions): string;
  close(): Promise<void>;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/**
 * The issuer's signing key: the same one on every run on this machine.
 *
 * SpacetimeDB caches an issuer's keys, and it does not fetch the JWKS again for an
 * unknown `kid`. A server can outlive one test run: a developer's `deploy.sh local`,
 * or the Playwright worker that restarts after a failing test. A new key per run would
 * make every token after the first run fail with "Unauthorized". So the key is made
 * once and kept outside the repo. It signs nothing but test tokens for 127.0.0.1, so
 * the only thing to protect is it being mistaken for a real secret by a scanner.
 */
function signingKey(port: number): KeyObject {
  const dir = join(homedir(), '.cache', 'boc-e2e');
  const file = join(dir, `issuer-${port}.pem`);
  try {
    return createPrivateKey(readFileSync(file, 'utf8'));
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    return privateKey;
  }
}

/**
 * Mint tokens for the issuer on `port` without serving anything. Its key is the one
 * `startIssuer(port)` serves, so these tokens are valid wherever an issuer on that
 * port is listening, in this process or another.
 */
export function createMinter(port: number): (options: MintOptions) => string {
  const issuer = `http://127.0.0.1:${port}`;
  const kid = `e2e-key-${port}`;
  const privateKey = signingKey(port);
  return ({ sub, aud, emailVerified }: MintOptions): string => {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { iss: issuer, sub, aud, iat: now, exp: now + 3600 };
    if (emailVerified !== undefined) {
      claims.email = `${sub}@example.test`;
      claims.email_verified = emailVerified;
    }
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const payload = b64url(JSON.stringify(claims));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
  };
}

export function startIssuer(port: number): Promise<MockIssuer> {
  const issuer = `http://127.0.0.1:${port}`;
  const kid = `e2e-key-${port}`;
  const publicKey = createPublicKey(signingKey(port));
  const mint = createMinter(port);

  const server: Server = createServer((req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', issuer).pathname;
    if (path === '/.well-known/openid-configuration') {
      return json({
        issuer,
        jwks_uri: `${issuer}/jwks`,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (path === '/jwks') {
      return json({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }],
      });
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        issuer,
        mint,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    );
  });
}
