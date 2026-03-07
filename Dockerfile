# Use official Node.js image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Build the Next.js app
RUN npm run build

# Expose port and start
EXPOSE 3000
CMD ["npm", "start"]
