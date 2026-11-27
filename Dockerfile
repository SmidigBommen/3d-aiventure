FROM node:26-alpine AS client
WORKDIR /app
RUN npm install -g --allow-scripts=pnpm pnpm@12.21.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY client ./client
RUN pnpm build

FROM python:3.13-slim
# curl is for the container health check.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY *.py ./
COPY engine ./engine
COPY json ./json
COPY web ./web
COPY --from=client /app/client/dist ./client/dist
# Sessions and saves live here. Mount a volume to keep them across deploys.
VOLUME /data
ENV AIVENTURE_DATA=/data PATH="/app/.venv/bin:$PATH"
EXPOSE 80
# One worker: game state is stored in files, one per session.
CMD ["uvicorn", "web.app:app", "--host", "0.0.0.0", "--port", "80"]
