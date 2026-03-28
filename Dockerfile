FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV WEIXIN_GATEWAY_PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md LICENSE CHANGELOG.md CONTRIBUTING.md ./

EXPOSE 8787

CMD ["node", "src/server.js"]
