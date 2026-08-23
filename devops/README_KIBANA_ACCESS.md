# Accéder à Kibana

Avant de lancer la stack, il faut remplir les différents mots de passe nécessaires aux services ELK dans le fichier `.env`.

## Générer les clés de chiffrement Kibana

Kibana utilise trois clés de chiffrement :

- `XPACK_SECURITY_ENCRYPTIONKEY`
- `XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY`
- `XPACK_REPORTING_ENCRYPTIONKEY`

Elles doivent être définies dans le `.env`.

Pour générer une clé suffisamment longue et aléatoire, on peut utiliser :

```bash
openssl rand -hex 32
```

Il faut exécuter la commande **3 fois** et utiliser une valeur différente pour chaque clé.

```env
XPACK_SECURITY_ENCRYPTIONKEY=<clé_1>
XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY=<clé_2>
XPACK_REPORTING_ENCRYPTIONKEY=<clé_3>
```

Il est important de conserver ces clés : les changer après coup peut rendre certaines données Kibana chiffrées précédemment illisibles.

## Lancer les services

Une fois le `.env` correctement rempli :

```bash
docker compose up -d --build
```

Attendre que les services soient démarrés et que Kibana soit disponible.

## Accéder à Kibana

Kibana est accessible via :

```text
https://localhost/kibana
```

Nginx sert de reverse proxy vers Kibana.

## Connexion à Kibana

Deux utilisateurs peuvent être utilisés.

### 1. `elastic` — accès administrateur

```text
Username : elastic
Password : ${ELASTIC_PASSWORD}
```

Ce compte possède les droits d'administration et permet notamment de modifier la configuration et les données Elasticsearch/Kibana.

### 2. `factarena` — accès lecture seule

```text
Username : factarena
Password : ${KIBANA_APP_PASSWORD}
```

Ce compte est destiné à la consultation des logs et des dashboards en **lecture seule**.

## Démonstration Kibana

Deux démonstrations ont été créées afin de montrer les principales possibilités de Kibana : **Discover** et **Dashboard**.

### Discover

Dans le menu situé à gauche, sélectionner **Discover**.

En haut à gauche du tableau :

1. Cliquer sur les **trois petits points**.
2. Sélectionner **« Ouvrir la session »**.
3. Choisir **`DataView Demo`**.

Plusieurs onglets sont alors disponibles, correspondant aux différents services de l'application.

Chaque onglet affiche un tableau contenant les événements du service concerné, avec notamment différentes informations utiles au **debugging** :

- date et heure du log ;
- service concerné ;
- niveau du log ;
- message ;

On peut ajouter d'autres colonnes si nécessaire grâce à la liste des données disponibles sur la bande à gauche :
- message original ;
- conteneur Docker ;
- image Docker ;
- autres métadonnées GELF ;
- ...

Il est également possible d'utiliser les filtres et la recherche de Kibana afin d'isoler rapidement certains types de logs ou certains services.

Par exemple :
filtre : "log.level" est/is/: "error".

### Dashboard

Dans le menu de gauche, sélectionner **Dashboard**.

Choisir ensuite **`Dashboard Demo`**.

Une configuration de démonstration s'ouvre avec plusieurs visualisations permettant d'avoir un aperçu de ce qu'il est possible de réaliser avec Kibana.

Le dashboard permet notamment de visualiser rapidement :

- la répartition des logs ;
- les différents niveaux de logs ;
- les services concernés ;
- les erreurs et événements problématiques actuellement présents dans les logs.

## Remarques

Le parsing des logs est perfectible (surtout pour frontend qui pour l'instant n'a pas de logs pertinants). Donc n'hésitez pas à changer les nomduservice.conf pour un meilleur traitement de vos évènements.


# Importer vos propres DataViews/Dashboards

## Créer vos propres Data Views et Dashboards sans supprimer les démos

Les démonstrations `DataView Demo` et `Dashboard Demo` peuvent être conservées et utilisées comme exemples. Pour créer vos propres éléments, il est préférable de créer de nouveaux objets plutôt que de modifier ou supprimer les démos.

### Créer un nouveau Data View

1. Aller dans :

   **Stack Management → Data Views**

2. Cliquer sur :

   **Create data view**

3. Donner un nom à votre Data View.

   Exemple :

   ```text
   Factarena Logs
   ```

4. Pour l'index pattern, utiliser :

   ```text
   factarena-logs-*
   ```

5. Sélectionner le champ temporel :

   ```text
   @timestamp
   ```

6. Cliquer sur **Save data view**.

Le nouveau Data View permet maintenant d'accéder à l'ensemble des index :

```text
factarena-logs-2026.08.23
factarena-logs-2026.08.24
factarena-logs-2026.08.25
...
```

### Créer un nouveau Dashboard

1. Aller dans :

   **Dashboard**

2. Cliquer sur :

   **Create dashboard**

3. Cliquer sur :

   **Create visualization** ou **Add panel**.

4. Sélectionner le Data View créé précédemment.

5. Créer les visualisations souhaitées.

   Par exemple :

   * nombre de logs par service ;
   * nombre d'erreurs ;
   * répartition des niveaux de logs ;
   * évolution du nombre de logs dans le temps ;
   * logs par conteneur ;
   * logs par type de service.

6. Ajouter les différentes visualisations au dashboard.

7. Donner un nom au dashboard.

   Exemple :

   ```text
   Factarena Monitoring
   ```

8. Sauvegarder le dashboard.

### Ne pas modifier les démos

Les objets suivants servent de démonstration et doivent être conservés :

```text
DataView Demo
Dashboard Demo
```

Pour créer vos propres dashboards, créez simplement de nouveaux objets.

Cela permet aux nouveaux développeurs de conserver les exemples existants tout en ayant la possibilité de créer leurs propres visualisations.

### Exporter votre travail

Une fois votre Data View et votre Dashboard terminés, il est possible de les exporter sous forme de fichier `.ndjson`.

Les fichiers `.ndjson` permettent d'exporter des **Saved Objects** Kibana, comme les Data Views, dashboards et visualisations, afin de pouvoir les réimporter sur une autre instance Kibana.

### Depuis l'interface Kibana

1. Se connecter à Kibana avec l'utilisateur `elastic`.
2. Dans le menu de gauche, aller dans :

   **Stack Management**

3. Dans la rubrique **Kibana**, sélectionner :

   **Saved Objects**

4. En haut à droite, cliquer sur :

   **Export**

5. Cocher TOUS les objets pour les exporter sans écraser les précédentes.

6. Cliquer sur **Export**.

7. Kibana télécharge automatiquement un fichier :

```text
export.ndjson
```

Ce fichier peut ensuite être renommé :

```text
dashboard-demo.ndjson
```

Pour remplacé le fichier dans le dossier `devops/elk/kibana/dashboards/`

### Attention

Lorsqu'un dashboard ou une visualisation est modifié, il faut penser à réexporter le `.ndjson` afin que les modifications soient disponibles pour les autres développeurs et lors d'un nouveau déploiement.

Il est également recommandé de conserver le fichier `.ndjson` dans le repository avec les autres fichiers de configuration Kibana.