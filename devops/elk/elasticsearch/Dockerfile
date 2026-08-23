FROM docker.elastic.co/elasticsearch/elasticsearch:9.5.1

USER root

COPY --chown=1000:0 config/elasticsearch.yml \
    /usr/share/elasticsearch/config/elasticsearch.yml

RUN mkdir -p /snapshots \
    && chown 1000:0 /snapshots \
    && chmod 0750 /snapshots

COPY init-elasticsearch.sh /usr/local/bin/init-elasticsearch.sh

COPY ilm /usr/local/share/elasticsearch-config/ilm
COPY snapshots /usr/local/share/elasticsearch-config/snapshots
COPY templates /usr/local/share/elasticsearch-config/templates

RUN chmod +x /usr/local/bin/init-elasticsearch.sh \
    && chown -R 1000:0 /usr/local/share/elasticsearch-config

USER elasticsearch

ENTRYPOINT ["/usr/local/bin/init-elasticsearch.sh"]