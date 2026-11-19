// A minimal OIDC issuer for the M14.2 spike: discovery, JWKS, and a /mint endpoint
// that hands out signed ID tokens on request. It stands in for a hosted provider
// (SpacetimeAuth, Auth0...) so the spike needs no account. A real provider makes the
// user log in before minting, which is the part this skips and the part that does
// not concern SpacetimeDB.
//
//   node issuer.mjs <port>
//
//   GET /mint?sub=alice&aud=boc-spike           a valid RS256 ID token
//   GET /mint?sub=alice&aud=boc-spike&forge=1   same claims, signed by a key not in the JWKS
//   GET /mint?sub=alice&aud=boc-spike&exp=-60   expired 60 seconds ago
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';

const port = Number(process.argv[2] ?? 3200);
const issuer = `http://127.0.0.1:${port}`;
const kid = 'spike-key-1';
const real = generateKeyPairSync('rsa', { modulusLength: 2048 });
const forger = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64url = (data) => Buffer.from(data).toString('base64url');

function mint({ sub, aud, exp, forge }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(
    JSON.stringify({ iss: issuer, sub, aud, iat: now, exp: now + Number(exp ?? 3600) }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign((forge ? forger : real).privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', issuer);
  const json = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/.well-known/openid-configuration') {
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
  if (url.pathname === '/jwks') {
    return json({
      keys: [
        { ...real.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
      ],
    });
  }
  if (url.pathname === '/mint') {
    const q = url.searchParams;
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(
      mint({
        sub: q.get('sub'),
        aud: q.get('aud'),
        exp: q.get('exp'),
        forge: q.has('forge'),
      }),
    );
  }
  res.writeHead(404);
  res.end();
}).listen(port, '127.0.0.1', () => console.log(`issuer ${issuer} up`));
