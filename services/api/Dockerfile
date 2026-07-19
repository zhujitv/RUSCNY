# syntax=docker/dockerfile:1

# Build from the repository root so npm workspaces and the committed lockfile
# are the single dependency source for local, CI, and production builds.
FROM node:22.23.1-alpine3.24 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json ./services/api/package.json
COPY services/api/prisma ./services/api/prisma
RUN npm ci

FROM dependencies AS build
COPY services/api/tsconfig.json ./services/api/tsconfig.json
COPY services/api/src ./services/api/src
RUN npm run db:generate && npm run build

# Use this target for the one-shot migration job. It intentionally retains the
# Prisma CLI from devDependencies; API replicas must not run migrations.
FROM dependencies AS migration
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:22.23.1-alpine3.24 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/api/package.json ./services/api/package.json
COPY services/api/prisma ./services/api/prisma
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/services/api/dist ./services/api/dist
COPY apps/admin-web ./apps/admin-web
COPY apps/customer-web ./apps/customer-web
COPY deploy/deep-links/site/join ./deploy/deep-links/site/join
RUN mkdir -p /app/storage/audio && chown -R node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/api/dist/server.js"]

# Railway runs the pre-deploy migration command inside the final image. Keep a
# dedicated platform target with the Prisma CLI while the normal runtime target
# above remains minimal for CI, Compose and immutable registry releases.
FROM dependencies AS railway
ENV NODE_ENV=production
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/services/api/dist ./services/api/dist
COPY apps/admin-web ./apps/admin-web
COPY apps/customer-web ./apps/customer-web
COPY deploy/deep-links/site/join ./deploy/deep-links/site/join
RUN mkdir -p /app/storage/audio && chown -R node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/api/dist/server.js"]
