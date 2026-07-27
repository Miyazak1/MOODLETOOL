#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-portal.example.com}"
PORTAL_DIR="${PORTAL_DIR:-/www/wwwroot/ossd-course-portal}"
DATA_DIR="${DATA_DIR:-/www/wwwroot/ossd-portal/data}"
COURSE_ACTIVE_DIR="${COURSE_ACTIVE_DIR:-/www/wwwroot/ossd-portal/courseware-active}"
COURSE_ARCHIVE_DIR="${COURSE_ARCHIVE_DIR:-/www/wwwroot/ossd-portal/courseware-archive}"
SERVICE_NAME="${SERVICE_NAME:-ossd-course-portal}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root, for example: sudo DOMAIN=portal.example.com bash deployment/bootstrap-linux-server.sh" >&2
  exit 1
fi

mkdir -p "$PORTAL_DIR" "$DATA_DIR" "$COURSE_ACTIVE_DIR" "$COURSE_ARCHIVE_DIR"

if [[ ! -f "$PORTAL_DIR/server.mjs" ]]; then
  echo "Warning: $PORTAL_DIR/server.mjs not found yet."
  echo "Upload the project files to $PORTAL_DIR before starting the service."
fi

install -m 0644 "$SCRIPT_DIR/ossd-course-portal.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s#WorkingDirectory=/var/www/ossd-course-portal#WorkingDirectory=${PORTAL_DIR}#g" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s#WorkingDirectory=/www/wwwroot/ossd-course-portal#WorkingDirectory=${PORTAL_DIR}#g" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s#/usr/bin/node#${NODE_BIN}#g" "/etc/systemd/system/${SERVICE_NAME}.service"

if command -v nginx >/dev/null 2>&1; then
  install -m 0644 "$SCRIPT_DIR/nginx-ossd-course-portal.conf" "/etc/nginx/sites-available/${SERVICE_NAME}"
  sed -i "s#server_name portal.example.com;#server_name ${DOMAIN};#g" "/etc/nginx/sites-available/${SERVICE_NAME}"
  sed -i "s#alias /www/wwwroot/ossd-portal/courseware-active/;#alias ${COURSE_ACTIVE_DIR%/}/;#g" "/etc/nginx/sites-available/${SERVICE_NAME}"
  ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  nginx -t
else
  echo "nginx not found; install nginx before enabling the provided config."
fi

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

cat <<EOF

Bootstrap complete.

Portal dir:     $PORTAL_DIR
Data dir:       $DATA_DIR
Active courses: $COURSE_ACTIVE_DIR
Course archive: $COURSE_ARCHIVE_DIR
Domain:         $DOMAIN
Service:        $SERVICE_NAME

Next steps:
1. Upload the Baota release package to $PORTAL_DIR and extract it.
2. Create $PORTAL_DIR/.env.production from .env.production.example.
3. Run: cd $PORTAL_DIR && npm install --omit=dev && npm run build
4. Run: cd $PORTAL_DIR && npm run check:production-env -- --env .env.production
5. Upload active course folders to $COURSE_ACTIVE_DIR/<COURSE>
6. Run: sudo systemctl restart $SERVICE_NAME
7. Run: sudo systemctl reload nginx
8. Test: http://${DOMAIN}/

EOF
