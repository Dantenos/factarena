FROM docker.elastic.co/kibana/kibana:9.5.1

USER root

COPY init-kibana.sh /usr/local/bin/init-kibana.sh

RUN chmod +x /usr/local/bin/init-kibana.sh

COPY --chown=1000:0 config/kibana.yml /usr/share/kibana/config/kibana.yml

COPY --chown=1000:0 dashboards/dashboard-demo.ndjson /usr/share/kibana/config/dashboard.ndjson

USER kibana

ENTRYPOINT ["/usr/local/bin/init-kibana.sh"]