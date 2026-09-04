// IdP OIDC mocké pour le smoke test du SSO — HTTPS local auto-signé.
// L'issuer annoncé est https://host.docker.internal:<port> : l'app conteneurisée
// (via Docker Desktop) atteint l'IdP qui tourne SUR L'HÔTE, et l'hôte atteint
// l'IdP avec curl --resolve host.docker.internal:<port>:127.0.0.1.
//
// Usage :
//   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1 \
//     -nodes -subj "/CN=host.docker.internal" \
//     -addext "subjectAltName=DNS:host.docker.internal,IP:127.0.0.1"
//   node tests/mock-idp.mjs 8443 key.pem cert.pem 0.0.0.0
//   docker compose up -d --build   avec dans .env :
//     OIDC_ISSUER=https://host.docker.internal:8443
//     OIDC_CLIENT_ID=learngame-test  OIDC_CLIENT_SECRET=secret-test
//     NODE_EXTRA_CA_CERTS=<cert.pem monté dans le conteneur>
// Puis : GET /api/auth/oidc/start → suivre la redirection (l'IdP renvoie un
// code immédiatement) → le callback crée la session. L'identité délivrée est
// test-sso-marie / marie.dupont@univ-pau.fr (nettoyer avec les outils habituels).
// Le mock vérifie client_secret_post ET PKCE S256 — un client mal implémenté
// est rejeté. Signe le ID token en RS256 (kid « test-key-1 »).

import https from "node:https";
import fs from "node:fs";
import { createHash, generateKeyPairSync, createSign, randomBytes } from "node:crypto";

const port = Number(process.argv[2] ?? 8443);
const bindAddress = process.argv[5] ?? "127.0.0.1";
const ISSUER = `https://host.docker.internal:${port}`; // issuer vu depuis le conteneur de l'app
const CLIENT_ID = "learngame-test";
const CLIENT_SECRET = "secret-test";
const SUB = "test-sub-42";
const USERNAME = "test-sso-marie";
const EMAIL = "marie.dupont@univ-pau.fr";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pubJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key-1", alg: "RS256", use: "sig" };
const b64u = (buf) => Buffer.from(buf).toString("base64url");

const challenges = new Map(); // code → { challenge, nonce, state }

function signJwt(payload) {
  const data = `${b64u(JSON.stringify({ alg: "RS256", kid: "test-key-1" }))}.${b64u(JSON.stringify(payload))}`;
  return `${data}.${b64u(createSign("RSA-SHA256").update(data).sign(privateKey))}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(new URLSearchParams(d)));
  });
}

const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oidcAuthorize`,
  token_endpoint: `${ISSUER}/oidcAccessToken`,
  userinfo_endpoint: `${ISSUER}/oidcProfile`,
  jwks_uri: `${ISSUER}/jwks`,
  scopes_supported: ["openid", "profile", "email"],
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["plain", "S256"],
  token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  id_token_signing_alg_values_supported: ["none", "HS256", "RS256"], // volontairement permissif : le client doit choisir RS256
};

const server = https.createServer(
  { key: fs.readFileSync(process.argv[3]), cert: fs.readFileSync(process.argv[4]) },
  async (req, res) => {
    const url = new URL(req.url, ISSUER);
    res.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/.well-known/openid-configuration") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(discovery));
    } else if (url.pathname === "/jwks") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [pubJwk] }));
    } else if (url.pathname === "/oidcAuthorize") {
      const code = "code-" + randomBytes(8).toString("hex");
      challenges.set(code, {
        challenge: url.searchParams.get("code_challenge"),
        nonce: url.searchParams.get("nonce"),
        state: url.searchParams.get("state"),
      });
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { Location: redirect.toString() });
      res.end();
    } else if (url.pathname === "/oidcAccessToken") {
      const body = await readBody(req);
      // Auth client_secret_post (défaut de la librairie)
      if (body.get("client_id") !== CLIENT_ID || body.get("client_secret") !== CLIENT_SECRET) {
        res.writeHead(401).end(JSON.stringify({ error: "invalid_client" }));
        return;
      }
      const entry = challenges.get(body.get("code"));
      if (!entry) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      // PKCE S256 : le verifier doit correspondre au challenge de l'autorisation
      const computed = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
      if (computed !== entry.challenge) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid_grant", error_description: "pkce mismatch" }));
        return;
      }
      challenges.delete(body.get("code"));
      const now = Math.floor(Date.now() / 1000);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "at-" + body.get("code"),
          token_type: "Bearer",
          expires_in: 3600,
          id_token: signJwt({ iss: ISSUER, sub: SUB, aud: CLIENT_ID, iat: now, exp: now + 3600, nonce: entry.nonce }),
        })
      );
    } else if (url.pathname === "/oidcProfile") {
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith("Bearer at-")) {
        res.writeHead(401).end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          sub: SUB,
          preferred_username: USERNAME,
          email: EMAIL,
          email_verified: true,
          name: "Marie Dupont",
        })
      );
    } else {
      res.writeHead(404).end();
    }
  }
);

server.listen(port, bindAddress, () =>
  console.log(`IdP mocké en écoute sur https://${bindAddress}:${port} (issuer annoncé : ${ISSUER})`)
);
