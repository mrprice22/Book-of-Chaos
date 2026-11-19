"""M14.5: a worker in the shape every integration's will have, with the standard library only.

    python3 worker.py <http-base> <db> <token-file> <label>

The first run has no token file. It asks the server for an identity
(POST /v1/identity) and saves the token with owner-only permissions. Every later run
loads the token and is the same identity. Each run then:

  1. calls the `hello` reducer over HTTP with its label,
  2. reads its own row back with SQL and prints the identity the *server* recorded
     (not the one the token claims, which a client could misreport),
  3. calls `refuse` and prints the reducer's error message.

The output is one JSON object, which run.sh compares across processes.
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.request


def request(method, url, token=None, body=None, content_type="application/json"):
    data = None if body is None else body.encode()
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


def load_or_mint(base, token_file):
    if os.path.exists(token_file):
        with open(token_file) as f:
            return f.read().strip(), False
    status, body = request("POST", f"{base}/v1/identity")
    if status != 200:
        sys.exit(f"could not mint an identity: {status} {body}")
    token = json.loads(body)["token"]
    # Owner-only from the first byte: the token *is* the worker's identity.
    fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(token)
    return token, True


def claims(token):
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def main():
    base, db, token_file, label = sys.argv[1:5]
    token, minted = load_or_mint(base, token_file)

    status, body = request("POST", f"{base}/v1/database/{db}/call/hello", token, json.dumps([label]))
    if status != 200:
        sys.exit(f"hello failed: {status} {body}")

    sql = f"SELECT * FROM hellos WHERE label = '{label}'"
    status, body = request("POST", f"{base}/v1/database/{db}/sql", token, sql, "text/plain")
    if status != 200:
        sys.exit(f"sql failed: {status} {body}")
    rows = json.loads(body)[0]["rows"]

    refused_status, refused_body = request("POST", f"{base}/v1/database/{db}/call/refuse", token, "[]")

    c = claims(token)
    print(json.dumps({
        "label": label,
        "minted_token": minted,
        "server_recorded_identity": rows[0][2][0] if len(rows) == 1 else None,
        "token_claims": {k: c.get(k) for k in ("iss", "sub", "hex_identity", "iat", "exp")},
        "refuse": {"status": refused_status, "message": refused_body},
    }))


if __name__ == "__main__":
    main()
