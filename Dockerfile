FROM node:22-slim AS frontend
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.js index.html ./
COPY frontend ./frontend
COPY public ./public
RUN pnpm build

FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY backend ./backend
RUN pip install --no-cache-dir . && useradd --create-home app && mkdir /data && chown app:app /data
COPY --from=frontend /app/dist ./dist
USER app
ENV AGENTBUDGET_DB=/data/ledger.sqlite
EXPOSE 8000
CMD ["agentbudget", "serve", "--host", "0.0.0.0"]
