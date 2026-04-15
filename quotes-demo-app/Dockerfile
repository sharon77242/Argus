FROM node:20-alpine as base
WORKDIR /src
COPY package*.json ./
EXPOSE 3000

FROM base as production
ENV NODE_ENV=production
RUN npm ci
COPY --chown=node:node . ./
USER node
CMD ["npm", "start"]

FROM base as dev
ENV NODE_ENV=development
RUN npm install -g nodemon && npm install
COPY . /src
CMD ["nodemon", "bin/www"]
