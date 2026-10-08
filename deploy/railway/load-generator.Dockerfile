# The load generator from deploy/vm, packaged for Railway. Build context: the repository root
# (RAILWAY_DOCKERFILE_PATH=deploy/railway/load-generator.Dockerfile).
FROM curlimages/curl:8.16.0
COPY deploy/vm/load-generator.sh /scripts/run.sh
CMD ["/bin/sh", "/scripts/run.sh"]
