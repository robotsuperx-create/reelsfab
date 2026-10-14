# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
# ffmpeg renders the reels; fonts feed the burned-in captions.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-montserrat fonts-noto-core fonts-dejavu-core ca-certificates \
 && fc-cache -f && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
# Kokoro TTS model cache lives in a writable, persistent-able location.
ENV NODE_ENV=production PORT=3000 HF_HOME=/app/.cache/hf AUTOPILOT_ENABLED=true
RUN mkdir -p /app/.cache/hf && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
