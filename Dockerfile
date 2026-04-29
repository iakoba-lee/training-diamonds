# Use the official Node.js full image
# (better-sqlite3 needs python and g++ to compile native binaries)
FROM node:22

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Bundle app source
COPY . .

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=3001

# The data directory is used for the sqlite database.
# We create it and set permissions so the node user can write to it.
RUN mkdir -p data && chown -R node:node data

# Switch to a non-root user for security
USER node

# Expose the application port
EXPOSE 3001

# Command to run the app
CMD [ "npm", "start" ]
