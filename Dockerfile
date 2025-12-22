# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY source/ ./source/

# Run build (tsc and copyfiles)
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/build ./build

# Change to build directory to match bot's relative path expectations
WORKDIR /app/build

EXPOSE 80
EXPOSE 8080

# Command to run the bot
CMD ["node", "earthiverse.js"]
