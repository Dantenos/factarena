FROM docker.elastic.co/logstash/logstash:9.5.1

USER root

COPY init-logstash.sh /usr/local/bin/init-logstash.sh

RUN chmod +x /usr/local/bin/init-logstash.sh

COPY --chown=1000:0 config/logstash.yml  /usr/share/logstash/config/logstash.yml

COPY --chown=1000:0 pipelines.yml  /usr/share/logstash/config/pipelines.yml

COPY --chown=1000:0 log-config/  /usr/share/logstash/log-conf/

USER logstash

ENTRYPOINT ["/usr/local/bin/init-logstash.sh"]