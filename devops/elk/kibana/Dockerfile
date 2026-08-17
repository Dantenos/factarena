FROM docker.elastic.co/kibana/kibana:9.5.1

USER root

COPY init-kibana.sh /usr/local/bin/init-kibana.sh

RUN chmod +x /usr/local/bin/init-kibana.sh

USER kibana

ENTRYPOINT ["/usr/local/bin/init-kibana.sh"]