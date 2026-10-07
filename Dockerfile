# Production image of the API. Locally the API runs outside Docker
# (`npm run start:dev`); the Compose file only holds its dependencies.
#
#   docker build -t administranest-api .

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Prisma's schema engine (`migrate deploy` on start) links against OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY --from=build /app/dist ./dist

# The database is reached over the internet (TLS only), so the API verifies
# its certificate: Node trusts the RDS certificate authority through this file.
ADD https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem /app/certs/rds-ca.pem
RUN chmod 644 /app/certs/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds-ca.pem

USER node
EXPOSE 3000

# Migrations run before the server takes traffic. Two instances starting
# together is safe: `migrate deploy` holds an advisory lock on the database.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/src/main"]
