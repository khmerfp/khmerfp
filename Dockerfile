# syntax=docker/dockerfile:1

# ---- Dependencies (all npm workspaces) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci

# ---- Client build (static files for nginx) ----
FROM deps AS client-build
COPY client ./client
RUN npm run build --workspace client

# ---- API runtime ----
FROM deps AS server
ENV NODE_ENV=production
WORKDIR /app
COPY server ./server
EXPOSE 3000
CMD ["node", "server/src/server.js"]

# ---- Web server (nginx serving the built client) ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html
EXPOSE 80
