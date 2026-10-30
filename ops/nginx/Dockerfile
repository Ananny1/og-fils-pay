# Public entry point: nginx serving the built apps/web and apps/admin SPAs
# and proxying /v1 to apps/api. Build from the repo root:
#   docker build -f ops/nginx/Dockerfile --build-arg WEB_PUBLIC_URL=https://pay.example.com .
# (docker-compose.prod.yml does this.)

# --- stage 1: build both SPAs -------------------------------------------
FROM node:20-bookworm-slim AS spa
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/money/package.json packages/money/
COPY packages/events/package.json packages/events/
COPY packages/theme/package.json packages/theme/
COPY apps/api/package.json apps/api/
COPY apps/reporting/package.json apps/reporting/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
# --ignore-scripts: the SPAs need no native addons (argon2/sharp are API-only).
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/admin ./apps/admin
COPY tsconfig.base.json tsconfig.json ./

# Same-origin API calls: both SPAs call /v1 on the host that served them,
# and nginx proxies it. No CORS, cookies stay first-party.
ARG WEB_PUBLIC_URL=http://localhost
RUN VITE_API_BASE_URL="" npm run build -w apps/web \
 && VITE_ADMIN_API_BASE_URL="" VITE_WEB_BASE_URL="$WEB_PUBLIC_URL" npm run build -w apps/admin

# --- stage 2: nginx ------------------------------------------------------
FROM nginx:1.27.5-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY ops/nginx/nginx.conf /etc/nginx/nginx.conf
COPY ops/nginx/templates/ /etc/nginx/templates/
COPY ops/nginx/variants/ /etc/nginx/filspay-variants/
COPY ops/nginx/18-filspay-select-tls.envsh /docker-entrypoint.d/18-filspay-select-tls.envsh
RUN chmod +x /docker-entrypoint.d/18-filspay-select-tls.envsh \
 && mkdir -p /var/www/acme
COPY --from=spa /src/apps/web/dist /usr/share/nginx/html/web
COPY --from=spa /src/apps/admin/dist /usr/share/nginx/html/admin
