# syntax=docker/dockerfile:1.6

ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19   # <— valid default
FROM ${BUILD_FROM}

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=true

RUN apk add --no-cache \
      chromium nss freetype ttf-freefont harfbuzz \
      ca-certificates nodejs npm python3 make g++

COPY rootfs/ /
WORKDIR /opt/gategpt
COPY GateGPT/ .

RUN npm ci --production --omit=dev --no-progress \
 && npm cache clean --force

ENV NODE_ENV=production
CMD ["/init"]