FROM harbor.01lb.vip/common/node:16.20.0-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --registry https://registry.npmmirror.com
COPY . .

#RUN mkdir -p src/uploads

EXPOSE 3000

ENTRYPOINT [ "node" ]
CMD [ "server.js"]
