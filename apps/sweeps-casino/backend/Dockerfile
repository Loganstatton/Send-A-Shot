FROM node:22-alpine AS base
# Prisma's query/schema engine binaries need OpenSSL to run; without it
# they fail at runtime with an unhelpful "Could not parse schema engine
# response" error instead of a clear "openssl not found" message.
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# node_modules must come from the `build` stage, not `deps` -- `prisma
# generate` runs in `build` and writes the generated client into
# node_modules/@prisma/client; copying from `deps` (pre-generate) ships a
# stale/default client missing generated types and enums.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# prisma/seed.ts imports directly from TS source (../src/libs/...), so
# the runtime image needs src/ too, not just the compiled dist/.
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY package.json ./

EXPOSE 4000
# Applies pending migrations and (idempotently, via upserts) seeds demo
# data on every boot -- fine for this Phase 1 deployment; a real
# production rollout would run migrate/seed as a separate release step.
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node prisma/seed.ts && node dist/src/main.js"]
