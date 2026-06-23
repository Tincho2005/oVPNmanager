FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    wget \
    iproute2 \
    gawk \
    sed \
    procps \
    psmisc \
    findutils \
    openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
