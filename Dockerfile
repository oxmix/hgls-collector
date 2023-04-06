FROM node:18.15-buster-slim
MAINTAINER Oxmix <oxmix@me.com>

RUN apt update && apt -y install \
      curl procps mdadm ifstat sysstat smartmontools php-cli \
      redis-tools postgresql-client default-mysql-client \
    && apt-get autoremove -y && apt-get clean all \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/*

WORKDIR /app

COPY /client .
COPY /docker-entrypoint.bash .

RUN npm i && \
    chmod +x /app/docker-entrypoint.bash

ENTRYPOINT ["/app/docker-entrypoint.bash"]
