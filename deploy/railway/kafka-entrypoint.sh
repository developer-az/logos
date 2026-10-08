#!/bin/sh
# Advertise the broker under this service's private hostname (kafka.railway.internal when the
# service is named "kafka"), so clients on Railway's private network can reach it.
set -eu
export KAFKA_ADVERTISED_LISTENERS="INTERNAL://${RAILWAY_PRIVATE_DOMAIN:-localhost}:9092"
exec /__cacert_entrypoint.sh /etc/kafka/docker/run
