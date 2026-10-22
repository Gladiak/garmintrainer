FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY . .
ENV HOST=0.0.0.0 PORT=3000
CMD ["npm", "run", "dev:container"]

FROM development AS build
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json app.js ./
COPY --chown=node:node libs ./libs
COPY --chown=node:node routes ./routes
COPY --chown=node:node controllers ./controllers
COPY --chown=node:node helpers ./helpers
COPY --chown=node:node shared ./shared
COPY --chown=node:node langs ./langs
COPY --chown=node:node db/migrations ./db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app.js"]
