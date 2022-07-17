FROM node:18.2-buster-slim
MAINTAINER Oxmix <oxmix@me.com>

ENV DOCKERVERSION=20.10.13

ARG TARGETARCH
RUN DEBIAN_FRONTEND=noninteractive \
	&& case ${TARGETARCH} in arm64|arm/v8) ARCH="aarch64" ;; amd64) ARCH="x86_64" ;; esac \
	&& apt update \
    && apt -y install apt-utils curl procps mdadm ifstat sysstat smartmontools php-cli \
    	   redis-tools postgresql-client default-mysql-client \
    && curl -fsSLO https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKERVERSION}.tgz \
		&& tar xzvf docker-${DOCKERVERSION}.tgz --strip 1 -C /usr/local/bin docker/docker \
		&& rm docker-${DOCKERVERSION}.tgz \
    && apt-get autoremove -y && apt-get clean all \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/*

WORKDIR /app

COPY /client .
COPY /docker-entrypoint.bash .

RUN npm i && \
    chmod +x /app/docker-entrypoint.bash

ENTRYPOINT ["/app/docker-entrypoint.bash"]