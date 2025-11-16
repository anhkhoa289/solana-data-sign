# Multi-stage build for Solana consumer

# Stage 1: Build the Anchor program
FROM projectserum/build:v0.29.0 as anchor-builder

WORKDIR /workspace

# Copy Anchor project files
COPY Anchor.toml Cargo.toml ./
COPY programs ./programs

# Build the Anchor program
RUN anchor build

# Stage 2: Build the consumer application
FROM node:20-alpine as consumer-builder

WORKDIR /app

# Copy consumer package files
COPY consumer/package*.json ./consumer/
COPY consumer/tsconfig.json ./consumer/

# Install dependencies
WORKDIR /app/consumer
RUN npm install

# Copy consumer source code
COPY consumer/src ./src

# Build the consumer
RUN npm run build

# Stage 3: Runtime
FROM node:20-alpine

WORKDIR /app

# Install production dependencies
COPY consumer/package*.json ./
RUN npm install --production

# Copy built files
COPY --from=consumer-builder /app/consumer/dist ./dist
COPY --from=anchor-builder /workspace/target/idl ./target/idl
COPY --from=anchor-builder /workspace/target/types ./target/types

# Create directory for keypair
RUN mkdir -p /app

# Expose no ports (consumer only)
# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

# Run the consumer
CMD ["node", "dist/index.js"]
