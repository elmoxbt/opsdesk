# Postgres client (pg_dump matches the server major version) + AWS CLI for S3 copies.
FROM postgres:16.6-alpine
RUN apk add --no-cache aws-cli tzdata
COPY --chmod=755 backup.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["schedule"]
