ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

# Cài dependencies cơ bản
RUN apk add --no-cache bash curl jq git

# Cài Bun
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /usr/src/app

# Copy script khởi động
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Copy source app
COPY app/ /usr/src/app/

# Cài deps nếu có package.json
RUN if [ -f package.json ]; then bun install --frozen-lockfile || bun install; fi

ENV NODE_ENV=production
CMD ["/run.sh"]
