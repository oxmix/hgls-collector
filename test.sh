set -e

docker build -t hgls-collector-local .

docker rm -f hgls-collector-test
docker run -d --rm --name hgls-collector-test \
  --network host --privileged \
  -v /etc/fstab:/etc/fstab:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /root/.my.cnf:/root/.my.cnf:ro \
  -v /root/.pgpass:/root/.pgpass:ro \
  hgls-collector-local

docker image prune -f

docker logs -f hgls-collector-test