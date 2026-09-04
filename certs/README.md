# Certificats TLS (mode HTTPS_MODE=certs)

Déposez ici les **deux fichiers** servis par le proxy Caddy (noms exacts) :

- `fullchain.pem` — le certificat du domaine **plus la chaîne complète**
  (certificats intermédiaires inclus) ;
- `privkey.pem` — la clé privée correspondante (PEM : `BEGIN PRIVATE KEY`
  ou `BEGIN RSA PRIVATE KEY`).

Ils sont délivrés par le service informatique / l'autorité de certification de
l'université. Ensuite, dans `.env` :

```
HTTPS_MODE=certs
APP_DOMAIN=<le nom figurant dans le certificat>
```

puis `docker compose up -d --build` (ou `docker compose restart proxy` si la stack
tourne déjà).

⚠️ Ce dossier est **ignoré par git** (`.gitignore`) : les clés privées ne doivent
jamais être commitées. Après chaque renouvellement de certificat : remplacez les
fichiers puis `docker compose restart proxy`.
