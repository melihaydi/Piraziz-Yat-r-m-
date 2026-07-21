FROM node:20-alpine

WORKDIR /app

# Copy package dependencies
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Next.js telemetry disable
ENV NEXT_TELEMETRY_DISABLED 1

CMD ["npm", "run", "dev"]
