FROM node:20-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

# Bind is 0.0.0.0:$PORT inside the process (see src/api.ts). Railway/Render set PORT.
CMD ["pnpm", "start"]
