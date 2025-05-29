ARG TARGETARCH
ARG BUILD_FROM=ghcr.io/home-assistant/${TARGETARCH}-base:3.19
FROM ${BUILD_FROM}

# Install Node and build tools
RUN apk add --no-cache nodejs npm python3 make g++

# Copy add-on rootfs (s6-overlay service) first
COPY rootfs/ /

# Copy bot sources
WORKDIR /opt/gategpt
COPY GateGPT/ .

RUN npm ci --production && npm cache clean --force
ENV NODE_ENV=production

CMD ["/init"]