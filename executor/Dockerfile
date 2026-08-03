FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY executor ./executor
COPY lib/slug.ts ./lib/slug.ts

EXPOSE 3100

CMD ["pnpm", "exec", "tsx", "executor/index.ts"]
