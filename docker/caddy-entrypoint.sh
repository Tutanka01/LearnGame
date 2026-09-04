#!/bin/sh
# Génère la configuration Caddy à partir de l'environnement du conteneur
# (APP_DOMAIN, HTTPS_MODE) puis lance Caddy.
#
# Pourquoi un rendu au démarrage plutôt qu'un Caddyfile statique : la config
# est minuscule, les modes sont en nombre fini, et une erreur de configuration
# doit EMPÊCHER le démarrage du proxy (set -eu + garde-fous ci-dessous) plutôt
# que servir du HTTP en silence. Le proxy reste le seul point d'entrée public
# (80/443) ; l'app n'est jamais exposée directement.
#
# Modes (HTTPS_MODE) :
#   off    HTTP pur, port 80 (LAN sans TLS).
#   self   HTTPS avec l'Autorité interne de Caddy (certificats auto-gérés,
#          pour tester en LAN) — avertissement navigateur tant que le
#          certificat racine n'est pas importé sur les postes.
#   certs  HTTPS avec les certificats FOURNIS PAR L'OPÉRATEUR : copier
#          fullchain.pem + privkey.pem dans ./certs/ (monté en /certs, lecture
#          seule). C'est le mode de production : l'université délivre et
#          renouvelle les certificats ; après renouvellement,
#          `docker compose restart proxy` suffit.
#
# Remarque SSE : Caddy détecte les réponses en flux (text/event-stream) et
# désactive le buffering — la génération de jeux en direct fonctionne sans
# réglage particulier, contrairement à nginx.
set -eu

APP_DOMAIN="${APP_DOMAIN:-localhost}"
HTTPS_MODE="${HTTPS_MODE:-off}"
UPSTREAM="${APP_UPSTREAM:-learngame:3000}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"

# Garde-fou strict : APP_DOMAIN doit être un domaine nu (lettres, chiffres,
# points, tirets). Pas de protocole, pas de chemin, pas de port (la topologie
# intégrée ne sert que 80/443), pas d'espace ni d'accolade — ce qui exclut
# toute injection dans la configuration générée.
case "$APP_DOMAIN" in
  [A-Za-z0-9.-]*)
    case "$APP_DOMAIN" in
      *[!A-Za-z0-9.-]*)
        echo "proxy : APP_DOMAIN invalide (« $APP_DOMAIN ») — mettre le domaine nu, ex. learngame.univ-pau.fr (sans https://, sans port, sans chemin)" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "proxy : APP_DOMAIN invalide (« $APP_DOMAIN ») — mettre le domaine nu, ex. learngame.univ-pau.fr (sans https://, sans port, sans chemin)" >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname "$CADDYFILE")"

case "$HTTPS_MODE" in
  off)
    # HTTP pur (LAN sans TLS). Port 80 uniquement ; rien n'écoute sur 443.
    cat > "$CADDYFILE" <<EOF
# HTTP pur — généré par caddy-entrypoint.sh (HTTPS_MODE=off)
:80 {
	reverse_proxy $UPSTREAM
	request_body {
		max_size 2MB
	}
}
EOF
    ;;
  self)
    # HTTPS auto-géré par l'AC interne de Caddy : pour tester en LAN.
    # PAS de HSTS ici volontairement : les postes n'ont pas (encore) la racine
    # interne importée, et un HSTS d'un an bloquerait un retour en off.
    cat > "$CADDYFILE" <<EOF
# HTTPS auto-signé (AC interne de Caddy) — généré par caddy-entrypoint.sh (HTTPS_MODE=self)
$APP_DOMAIN:443 {
	tls internal
	reverse_proxy $UPSTREAM
	request_body {
		max_size 2MB
	}
}
EOF
    ;;
  certs)
    # HTTPS avec les certificats fournis par l'opérateur (./certs → /certs, ro).
    # Échouer tôt et bruyamment si les fichiers manquent : un proxy « sain » qui
    # ne servirait rien serait pire qu'un crash au démarrage.
    if [ ! -f /certs/fullchain.pem ] || [ ! -f /certs/privkey.pem ]; then
      echo "proxy : HTTPS_MODE=certs exige deux fichiers dans ./certs/ (monté en /certs) :" >&2
      echo "  - fullchain.pem : le certificat + la chaîne complète" >&2
      echo "  - privkey.pem   : la clé privée" >&2
      echo "Certificats délivrés par le service informatique / l'AC de l'université." >&2
      exit 1
    fi
    cat > "$CADDYFILE" <<EOF
# HTTPS avec certificats fournis — généré par caddy-entrypoint.sh (HTTPS_MODE=certs)
# Après renouvellement des certificats : docker compose restart proxy
$APP_DOMAIN:443 {
	tls /certs/fullchain.pem /certs/privkey.pem
	reverse_proxy $UPSTREAM
	request_body {
		max_size 2MB
	}
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
}
EOF
    ;;
  *)
    echo "proxy : HTTPS_MODE inconnu (« $HTTPS_MODE ») — valeurs acceptées : off | self | certs" >&2
    exit 1
    ;;
esac

echo "proxy : $APP_DOMAIN (HTTPS_MODE=$HTTPS_MODE) → $UPSTREAM"
exec caddy run --config "$CADDYFILE" --adapter caddyfile
