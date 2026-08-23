````md
# Infrastructure for log management using ELK

## Architecture générale

Docker → produit les logs des conteneurs.  
GELF → transporte les logs Docker vers Logstash.  
Logstash → reçoit, route, nettoie et parse les logs.  
Elasticsearch → stocke et indexe les événements.  
Kibana → permet de rechercher et visualiser les logs.

Le flux général est :

```text
┌──────────────────────┐
│ Docker containers    │
│                      │
│ backend              │
│ frontend             │
│ ai-service           │
│ nginx                │
│ postgres             │
│ kibana               │
│ ...                  │
└──────────┬───────────┘
           │
           │ GELF TCP :12201
           ▼
┌──────────────────────────────┐
│          Logstash            │
│                              │
│  1. Réception GELF           │
│  2. Préparation du log       │
│  3. Identification service   │
│  4. Routage                  │
│  5. Parsing spécifique       │
└──────────┬───────────────────┘
           │
           │ Elasticsearch API / HTTPS
           ▼
┌──────────────────────────────┐
│       Elasticsearch          │
│                              │
│ factarena-logs-2026.08.23    │
│ factarena-logs-2026.08.24    │
│ ...                          │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│           Kibana             │
│                              │
│ Discover / Dashboards        │
└──────────────────────────────┘
````

---

## 1. Collecte des logs avec Docker et GELF

Docker utilise le driver GELF pour envoyer les logs à Logstash.

Dans `docker-compose.yml`, les services concernés utilisent donc quelque chose de ce type :

```yaml
logging:
  driver: gelf
  options:
    gelf-address: "tcp://172.30.0.10:12201"
    gelf-tcp-max-reconnect: "10"
    gelf-tcp-reconnect-delay: "1"
    tag: "{{.Name}}"
```

Le choix de GELF nous permet de transmettre à la fois le message et des métadonnées Docker.

Un événement reçu par Logstash contient notamment :

```text
message
container_id
container_name
image_name
image_id
command
host
source_host
level
tag
created
```

Exemple :

```text
container_name = transcendance-backend-1
image_name     = transcendance-backend
level          = 6
message        = [Nest] 1 - 08/22/2026, 10:32:41 PM ...
```

Nous n'avons pas besoin de déterminer le service uniquement en analysant le texte du message.

On peut utiliser directement :

```text
container_name
```

---

## 2. Conservation du niveau GELF

GELF fournit un champ numérique `level`.

Par exemple :

```text
level = 6
```

correspond au niveau GELF INFO.

Nous avons choisi de ne pas transformer directement ce champ en `log.level`.

Le pipeline conserve explicitement sa valeur :

```ruby
mutate {
    copy => {
        "level" => "[gelf][level]"
    }
}
```

On obtient donc :

```json
{
  "level": 6,
  "gelf": {
    "level": 6
  }
}
```

### Pourquoi ?

Parce que le niveau GELF et notre niveau applicatif `log.level` ne représentent pas forcément exactement la même chose.

Par exemple, NestJS écrit :

```text
LOG
```

alors que GELF peut nous donner :

```text
6
```

On ne veut donc pas mélanger les deux concepts.

---

## 3. Conservation du log original

Avant le parsing, Logstash conserve le message reçu :

```ruby
if [message] {
    mutate {
        copy => {
            "message" => "[event][original]"
        }
    }
}
```

On obtient donc :

```text
message
    ↓
version de travail

event.original
    ↓
copie originale
```

Exemple :

Un log backend peut arriver avec des séquences ANSI :

```text
\e[32m[Nest] 1 - \e[39m08/22/2026...
```

`event.original` conserve cette version.

Le champ `message`, lui, peut être nettoyé pour faciliter le parsing.

Cela permet d'avoir simultanément :

```text
event.original = ce qui a réellement été reçu
message        = version exploitable par nos parsers
```

---

## 4. Identification du service

Le router Logstash regarde le nom du conteneur.

Exemple :

```text
transcendance-backend-1
```

devient :

```text
service.name = backend
```

Même principe pour :

```text
transcendance-kibana-1
transcendance-nginx-1
transcendance-ai-service-1
transcendance-frontend-1
transcendance-postgres-1
```

On obtient :

```text
kibana
backend
nginx
ai-service
frontend
postgres
```

Si aucun service connu ne correspond :

```text
service.name = generic
```

---

## 5. Routage vers les pipelines

Notre router possède ensuite une logique de ce type :

```ruby
if [service][name] == "kibana" {
    pipeline {
        send_to => "kibana"
    }
}
else if [service][name] == "backend" {
    pipeline {
        send_to => "backend"
    }
}
else if [service][name] == "nginx" {
    pipeline {
        send_to => "nginx"
    }
}
...
else {
    pipeline {
        send_to => "generic"
    }
}
```

Le rôle du router est donc uniquement de dire :

> « Ce log appartient au backend, envoie-le au pipeline backend. »

---

## 6. Un fichier `.conf` par service

Chaque service possède son propre fichier :

```text
logstash/
├── logstash.conf
├── router.conf
├── generic.conf
├── kibana.conf
├── backend.conf
├── frontend.conf
├── nginx.conf
├── ai-service.conf
└── postgres.conf
```

Chaque fichier service contient :

```text
input
filter
output
```

Par exemple :

### `backend.conf`

```text
input
   ↓
pipeline address "backend"

filter
   ↓
parsing NestJS

output
   ↓
Elasticsearch
```

Cette organisation permet de garder les configurations lisibles et indépendantes.

> À noter : les logs du frontend ne sont pas pertinents et concrets pour l'instant, donc il n'y a pas encore de vrai parsing dessus.

---

## 7. Gestion des erreurs de parsing

Chaque parser peut ajouter un tag en cas d'échec de parsing.

Pour le backend :

```text
_backend_parse_failure
```

Pour PostgreSQL :

```text
_postgres_parse_failure
```

C'est utile pour voir les logs structurés différemment sans les supprimer de la liste des logs et de pouvoir les consulter.

Si on voit :

```text
tags: ["_backend_parse_failure"]
```

cela signifie :

> Le log est bien arrivé jusqu'au pipeline backend, mais son format ne correspond pas au parser actuellement utilisé.

Ce n'est pas une erreur de GELF.

C'est une erreur de parsing Logstash.

---

## 8. Ajout de nouveaux services

Lorsqu'un nouveau développeur ajoute un service, il n'est pas obligé d'écrire immédiatement un parser.

Par exemple :

```text
transcendance-new-service-1
```

peut simplement être envoyé vers :

```text
service.name = new-service
```

puis stocké tel quel.

On peut ensuite observer quelques logs dans Kibana avant de décider si un parsing est réellement nécessaire.

Le pipeline générique sert justement de fallback.

Si le router ne connaît pas le service :

```text
service.name = generic
```

Le log peut être envoyé à :

```text
generic.conf
```

Le generic ne modifie pas le message.

Il peut simplement envoyer l'événement à Elasticsearch.

Ainsi, l'arrivée d'un nouveau service ne casse pas le pipeline global et est identifiable par :

```text
service.name = generic
```

---

# 9. Stockage et indexation Elasticsearch

Les événements sont actuellement stockés dans des index journaliers :

```text
factarena-logs-2026.08.22
factarena-logs-2026.08.23
factarena-logs-2026.08.24
```

Le pattern est :

```text
factarena-logs-*
```

Cela permet notamment à Kibana de travailler sur l'ensemble des logs.

Nous avons un index template :

```text
factarena_logs
```

avec :

```text
index_patterns:
    factarena-logs-*
```

Il permet d'appliquer automatiquement certaines propriétés aux nouveaux index.

C'est notamment là que nous pouvons définir des mappings et paramètres communs.

---

# 10. Rétention des logs avec ILM

Nous avons également mis en place une politique ILM.

La politique actuelle prévoit notamment la suppression des logs après :

```text
30 jours
```

Le but est d'éviter que les index Elasticsearch grossissent indéfiniment.

Le cycle est donc conceptuellement :

```text
Jour 1
   ↓
factarena-logs-2026.08.23
   ↓
...
   ↓
30 jours
   ↓
suppression
```

---

# 11. Archivage avec Elasticsearch Snapshots et SLM

La suppression des anciens index n'est pas notre seul mécanisme de conservation.

Nous avons également configuré les snapshots Elasticsearch.

Le repository utilise :

```text
/snapshots
```

avec un repository de type filesystem.

Les snapshots permettent de conserver une sauvegarde des données Elasticsearch indépendamment de la durée de vie des index actifs.

Le Snapshot Lifecycle Management (SLM) automatise les snapshots.

Notre politique prévoit notamment une conservation pouvant aller jusqu'à :

```text
90 jours
```

avec des contraintes de nombre minimum/maximum de snapshots.

On a donc deux mécanismes complémentaires :

```text
ILM
│
└── gestion des index actifs
    └── suppression après 30 jours

SLM
│
└── sauvegardes
    └── conservation des snapshots
```

---

# 12. Sécurisation de Logstash → Elasticsearch

La communication Logstash → Elasticsearch se fait en HTTPS.

Logstash utilise :

```text
LOGSTASH_USER
LOGSTASH_PASSWORD
```

et vérifie le certificat Elasticsearch via :

```text
ca.crt
```

Logstash dispose également de son certificat client :

```text
logstash.crt
logstash.pkcs8.key
```

La configuration ressemble donc conceptuellement à :

```ruby
elasticsearch {
    hosts => ["https://elasticsearch:9200"]

    user => "${LOGSTASH_USER}"
    password => "${LOGSTASH_PASSWORD}"

    ssl_enabled => true

    ssl_certificate_authorities => [
        "/usr/share/logstash/config/certs/ca/ca.crt"
    ]

    ssl_certificate =>
        "/usr/share/logstash/config/certs/logstash/logstash.crt"

    ssl_key =>
        "/usr/share/logstash/config/certs/logstash/logstash.pkcs8.key"
}
```

Les certificats ne sont pas simplement copiés dans tous les endroits du projet.

Logstash doit disposer de :

```text
CA
```

pour vérifier Elasticsearch, ainsi que de son certificat client.

Cela permet d'avoir :

```text
Logstash
   │
   │ TLS
   │ certificat client
   ▼
Elasticsearch
   │
   └── vérification via CA
```

---

# 13. Sécurisation de Kibana

Kibana est connecté à Elasticsearch avec la sécurité Elasticsearch activée.

Nous avons également automatisé une partie de l'initialisation via :

```text
init-kibana.sh
```

Le script :

1. attend Elasticsearch ;
2. configure les éléments nécessaires : users et passwords ;
3. démarre Kibana ;
4. attend que Kibana soit disponible ;
5. importe les saved objects nécessaires.

---

# 14. Accès à Kibana via Nginx

Kibana n'est pas exposé directement à l'extérieur.

Nginx sert de reverse proxy.

Le flux externe devient donc :

```text
Navigateur
    │
    ▼
  Nginx
    │
    └── /kibana/
            │
            ▼
          Kibana
```

Cela permet notamment de centraliser l'accès HTTPS et le routage.

---

# 15. Utilisation de Kibana

Dans Discover sur :

```text
/kibana
```

les champs importants sont notamment :

```text
@timestamp
service.name
log.level
log.logger
log.message
message
event.original
container_name
image_name
gelf.level
```

Cela permet notamment de filtrer les logs par :

* service ;
* niveau ;
* date ;
* contenu ;
* conteneur ;
* etc.

Les dashboards peuvent également être importés via les saved objects.

---

# 16. Debugging Logstash

Lorsqu'un nouveau parser ne fonctionne pas :

### 1. Vérifier GELF

Est-ce que le log arrive dans Logstash ?

```text
oui → continuer
non → problème Docker/GELF/réseau
```

### 2. Vérifier `service.name`

Exemple :

```text
service.name = backend
```

Si ce champ est incorrect :

```text
problème de router
```

### 3. Vérifier `message`

Regarder le contenu exact :

```text
message
```

### 4. Vérifier `event.original`

Permet de savoir si les modifications précédentes ont altéré le message.

### 5. Vérifier le parser

Si :

```text
_backend_parse_failure
```

apparaît, le problème est dans le parser du backend.

### 6. Utiliser `stdout { codec => rubydebug }`

```ruby
stdout {
    codec => rubydebug
}
```

permet de voir exactement ce que Logstash reçoit et produit.

Ne pas faire confiance uniquement à Kibana pour debugger.

Kibana montre le résultat après traitement.

Si quelque chose est incorrect, il est souvent plus efficace de regarder directement le rubydebug de Logstash.

Par exemple :

```text
"message" => "...",
"event" => {
    "original" => "..."
},
"service" => {
    "name" => "backend"
},
"tags" => [
    "_backend_parse_failure"
]
```

On sait alors immédiatement :

```text
GELF fonctionne ;
le routage fonctionne ;
le parser a été appelé ;
le parser a échoué.
```

C'est beaucoup plus précis que de simplement regarder le message final dans Kibana.

---

# 17. Ajouter un nouveau service

Supposons qu'un développeur ajoute :

```text
notifications
```

avec un conteneur :

```text
transcendance-notifications-1
```

## Étape 1 — ajouter le logging GELF

Dans `docker-compose.yml` :

```yaml
logging:
  driver: gelf
  options:
    gelf-address: "tcp://172.30.0.10:12201"
    gelf-tcp-max-reconnect: "10"
    gelf-tcp-reconnect-delay: "1"
    tag: "{{.Name}}"
```

## Étape 2 — ajouter le routage

Dans `router.conf` :
Dans la partie filter {} :

```ruby
else if [container_name] =~ /^transcendance-notifications-/ {
    mutate {
        add_field => {
            "[service][name]" => "notifications"
        }
    }
}
```

Puis :
Dans la partie output {} :

```ruby
else if [service][name] == "notifications" {
    pipeline {
        send_to => "notifications"
    }
}
```

## Étape 3 — créer le pipeline

Créer :

```text
notifications.conf
```

avec :

```ruby
input {
    pipeline {
        address => "notifications"
    }
}

filter {
    # Parsing uniquement si nécessaire
}

output {
    elasticsearch {
        hosts => ["https://elasticsearch:9200"]

        user => "${LOGSTASH_USER}"
        password => "${LOGSTASH_PASSWORD}"

        ssl_enabled => true

        ssl_certificate_authorities => [
            "/usr/share/logstash/config/certs/ca/ca.crt"
        ]

        ssl_certificate =>
            "/usr/share/logstash/config/certs/logstash/logstash.crt"

        ssl_key =>
            "/usr/share/logstash/config/certs/logstash/logstash.pkcs8.key"

        index => "factarena-logs-%{+YYYY.MM.dd}"

        ecs_compatibility => "v8"
    }

    # ==========================================================================
    # DEBUG
    # ==========================================================================

    # stdout {
    #   codec => rubydebug
    # }
}
```

## Étape 4 — tester

Lancer le service puis vérifier :

```text
service.name = notifications
```

dans Kibana.

## Étape 5 — ajouter un parser uniquement si nécessaire

Si les logs sont déjà exploitables :

```text
ne rien parser
```

Si le format est structuré :

```text
ajouter un grok/json/dissect/date/etc.
```

---

# 18. Résumé du chemin d'un log

Pour un log backend, par exemple :

```text
[Nest] 1 - 08/22/2026, 10:32:41 PM LOG [RouterExplorer] ...
```

le chemin complet est :

```text
Docker
  │
  │ GELF
  ▼
Logstash
  │
  ├── message
  ├── container_name
  ├── level
  ├── image_name
  └── autres métadonnées GELF
  │
  ▼
Préparation commune
  │
  ├── event.original
  ├── (nettoyage ANSI)
  └── gelf.level
  │
  ▼
Router
  │
  └── service.name = backend
  │
  ▼
backend.conf
  │
  ├── parsing NestJS
  ├── @timestamp
  ├── log.level
  ├── log.logger
  └── log.message
  │
  ▼
Elasticsearch
  │
  └── factarena-logs-YYYY.MM.DD
  │
  ▼
Kibana
```

---

# 19. TL;DR pour un développeur

### Les règles à retenir

```text
event.original = original.
message        = donnée de travail.
gelf.level     = niveau fourni par GELF.
log.level      = niveau interprété par notre parser.
service.name   = identité logique du service.
```

Un parser n'est **pas obligatoire**.

Un :

```text
_service_parse_failure
```

signifie que le log est arrivé au bon pipeline mais que son format n'a pas correspondu au parser.

Pour ajouter un service :

```text
1. ajouter logging GELF au docker-compose.yml
2. ajouter le routage dans router.conf
3. créer le .conf dédié
4. parser uniquement si nécessaire
```

---

# Correspondance avec les exigences du sujet de Transcendence

## DevOps Major — Infrastructure for log management using ELK

### Elasticsearch to store and index logs

> Elasticsearch reçoit les événements depuis Logstash et les stocke dans des index journaliers `factarena-logs-YYYY.MM.DD`. Un index template définit les règles communes de ces index.

### Logstash to collect and transform logs

> Docker envoie les logs via GELF/TCP à Logstash. Logstash conserve le log original dans `event.original`, nettoie notamment les codes ANSI, identifie le service, route les événements vers le pipeline approprié et parse les formats spécifiques (NestJS, PostgreSQL, Kibana, etc.).

### Kibana for visualization and dashboards

> Kibana est connecté à Elasticsearch et permet d'explorer les logs avec Discover, de filtrer par service/niveau/date et d'utiliser des dashboards importés via les saved objects.

### Log retention and archiving policies

> Une politique ILM supprime les logs après 30 jours afin d'éviter une croissance illimitée des index. Des snapshots Elasticsearch + SLM permettent de conserver des sauvegardes jusqu'à 90 jours indépendamment des index actifs.

### Secure access to all components

> Elasticsearch et Kibana utilisent X-Pack Security, avec authentification. Toute communication entre Logstash, Elasticsearch et Kibana est chiffrée en HTTPS/TLS, avec vérification par CA et certificats. Les mots de passe sont fournis via les variables d'environnement plutôt que stockés dans les configurations Logstash. Kibana est accessible via Nginx reverse proxy.