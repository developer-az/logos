# Single-node Kafka (KRaft) for Railway. Build context: the repository root
# (RAILWAY_DOCKERFILE_PATH=deploy/railway/kafka.Dockerfile).
FROM apache/kafka:4.3.1
# Railway mounts volumes owned by root; run as root so Kafka can write its log directory.
USER root
COPY deploy/railway/kafka-entrypoint.sh /railway-kafka.sh
# An empty listener host binds the wildcard address: IPv6 and IPv4 where IPv6 exists (Railway's
# private network is IPv6), plain IPv4 elsewhere.
ENV KAFKA_NODE_ID=1 \
    KAFKA_PROCESS_ROLES=broker,controller \
    KAFKA_LISTENERS=INTERNAL://:9092,CONTROLLER://:9093 \
    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=INTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT \
    KAFKA_INTER_BROKER_LISTENER_NAME=INTERNAL \
    KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
    KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
    KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
    KAFKA_AUTO_CREATE_TOPICS_ENABLE=false \
    KAFKA_LOG_RETENTION_HOURS=168 \
    KAFKA_LOG_DIRS=/var/lib/kafka/data \
    KAFKA_HEAP_OPTS="-Xms256m -Xmx512m"
ENTRYPOINT ["/bin/sh", "/railway-kafka.sh"]
