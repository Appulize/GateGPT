ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
FROM ${BUILD_FROM}

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV npm_config_cache=/tmp/.npm

# Install Node and build tools
RUN apk add --no-cache chromium nss freetype ttf-freefont harfbuzz ca-certificates nodejs npm python3 make g++

# Copy add-on rootfs (s6-overlay service) first
COPY rootfs/ /

# Copy bot sources
WORKDIR /opt/gategpt
COPY GateGPT/ .

RUN --mount=type=cache,id=gategpt-npm-${TARGETARCH},target=/tmp/.npm \
    npm ci --production --omit=dev --no-progress && \
    npm cache clean --force
ENV NODE_ENV=production

CMD ["/init"]