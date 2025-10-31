# syntax=docker/dockerfile:1.6

FROM --platform=$BUILDPLATFORM node:20.15.1-alpine AS deps
WORKDIR /opt/gategpt
COPY GateGPT/package.json GateGPT/package-lock.json ./
RUN npm ci --omit=dev --no-progress \
 && npm cache clean --force

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
COPY GateGPT/package.json GateGPT/package-lock.json ./
COPY --from=deps /opt/gategpt/node_modules ./node_modules
COPY GateGPT/ .

ENV NODE_ENV=production
ENV SESSION_DIR=/data

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "main.js"]

