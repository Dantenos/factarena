FROM docker.elastic.co/elasticsearch/elasticsearch:9.5.1

USER root

COPY init-elasticsearch.sh /usr/local/bin/init-elasticsearch.sh

RUN chmod +x /usr/local/bin/init-elasticsearch.sh

USER elasticsearch

ENTRYPOINT ["/usr/local/bin/init-elasticsearch.sh"]