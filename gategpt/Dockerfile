# syntax=docker/dockerfile:1.6

#FROM ghcr.io/home-assistant/amd64-base:3.19    AS base_amd64
#FROM ghcr.io/home-assistant/aarch64-base:3.19  AS base_arm64
FROM --platform=linux/amd64 alpine:3.19  AS base_amd64
FROM --platform=linux/arm64 alpine:3.19  AS base_arm64

ARG TARGETARCH
FROM base_${TARGETARCH}                        AS final

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=true

RUN apk add --no-cache \
      chromium nss freetype ttf-freefont harfbuzz \
      ca-certificates nodejs npm python3 make g++ tini

WORKDIR /opt/gategpt
COPY GateGPT/ .

RUN npm ci --production --omit=dev --no-progress \
 && npm cache clean --force

ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "main.js"]