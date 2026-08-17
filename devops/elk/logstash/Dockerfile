FROM docker.elastic.co/logstash/logstash:9.5.1

USER root

COPY init-logstash.sh /usr/local/bin/init-logstash.sh

RUN chmod +x /usr/local/bin/init-logstash.sh

USER logstash

ENTRYPOINT ["/usr/local/bin/init-logstash.sh"]