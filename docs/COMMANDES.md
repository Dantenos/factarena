# Commandes utiles — FactArena

Pense-bête des commandes qui servent au quotidien sur ce projet : démarrer,
diagnostiquer un service, inspecter le corpus de clips, tester une manche.

Tout part de la racine du dépôt.

---

## Démarrer et surveiller

```bash
docker compose up --build          # la commande unique exigée par le sujet
docker compose ps                  # état et santé des services
docker compose logs backend -f     # logs en direct d'un service
docker compose restart backend     # redémarrage simple, sans reconstruire
```

Reconstruire après une modification de code :

```bash
docker compose up -d --build backend frontend
```

Attendre qu'un service soit vraiment prêt (`Started` ne veut pas dire
`healthy` — le back met une trentaine de secondes à répondre) :

```bash
for i in $(seq 1 20); do
  s=$(docker compose ps backend --format '{{.Status}}')
  case "$s" in *healthy*) echo "$s"; break;; esac
  sleep 6
done
```

Repérer une erreur de compilation TypeScript après un build :

```bash
docker compose logs backend --since 3m | grep -iE "error TS|Nest can't resolve"
```

> ⚠️ **nginx écoute sur le port 8443**, pas 443. L'application est sur
> `https://localhost:8443`. Le certificat est auto-signé : Chrome affiche un
> avertissement, c'est normal en local.

Après avoir modifié le `.env` :

```bash
docker compose up -d --force-recreate backend
```

`restart` ne suffit pas. Les variables d'environnement sont figées à la création
du conteneur : un simple redémarrage relance l'ancienne configuration, et on
cherche longtemps pourquoi la nouvelle valeur n'est pas prise en compte. Pour
vérifier qui a raison du fichier ou du conteneur :

```bash
stat -c '%y' .env
docker inspect -f '{{.Created}}' "$(docker compose ps -q backend)"
```

Trois variables se réfèrent à l'URL publique et doivent toutes porter le port
8443 : `FORTYTWO_CALLBACK_URL`, `FRONTEND_URL`, et le « Redirect URI » déclaré
sur l'intranet 42.

---

## Vérifier les points d'entrée

```bash
curl -sk -o /dev/null -w 'front  : %{http_code}\n' https://localhost:8443/
curl -sk -o /dev/null -w 'api    : %{http_code}\n' https://localhost:8443/api/health
curl -sk -o /dev/null -w 'privacy: %{http_code}\n' https://localhost:8443/privacy
```

Tester la validation côté back en contournant le front — elle doit répondre
`400`, jamais créer le compte :

```bash
curl -sk -X POST https://localhost:8443/api/auth/register \
  -H 'Content-Type: application/json' -d '{"email":"pasunemail","password":"a"}'
```

---

## Interroger la base

Il n'y a pas de client `psql` configuré côté hôte. Le plus simple est de
passer par le conteneur `ai-service`, qui a déjà l'accès à la base :

```bash
docker compose exec -T ai-service python - <<'EOF'
from app.db import connect
with connect() as c, c.cursor() as cur:
    cur.execute('SELECT count(*) FROM "Claim"')
    print(cur.fetchone()[0])
EOF
```

Compter les clips réellement jouables, par verdict. Un clip n'est jouable que
si son média est lisible par le lecteur : WebM de Wikimedia, iframe Facebook
officielle, ou iframe YouTube.

```bash
docker compose exec -T ai-service python - <<'EOF'
from app.db import connect
with connect() as c, c.cursor() as cur:
    cur.execute("""SELECT "truthLabel", count(*) FROM "Claim"
                   WHERE "mediaRef" LIKE '%upload.wikimedia%'
                      OR "mediaRef" LIKE '%/embed/%'
                      OR "mediaRef" LIKE '%plugins/video.php%'
                   GROUP BY 1 ORDER BY 1""")
    for label, n in cur.fetchall():
        print(f"{label:5s} {n}")
EOF
```

Même requête groupée par `category` pour voir la répartition thématique.

---

## Corpus : les scripts d'entretien

Tous se lancent de la même façon, depuis `ai-service` :

```bash
docker compose exec ai-service python -m app.rag.<script>
```

| Script | Rôle |
|---|---|
| `signalements` | Liste les clips signalés par les joueurs ; `--ecarter` les retire du tirage |
| `filtrer_durees` | Écarte les clips trop longs (défaut 2 min 42) ; `--max 120` pour changer le seuil |
| `fix_media_webm` | Bascule les vidéos Theora (`.ogv`) en WebM — Chrome ne lit plus le Theora depuis la v123 |
| `verifier_videos_yt` | Détache les vidéos YouTube produites par la rédaction elle-même (habillage, animation pédagogique) |
| `manche_de_tri` | Crée une manche contenant tous les clips, pour les trier à l'écran |
| `claims_wtf` | Lot « surprenant mais vrai », écrit à la main sur des vidéos Wikimedia |
| `claims_manuelles` | Ajouts au cas par cas, après tri humain |
| `claims_confirmees` | Vidéos virales qu'un fact-checkeur a confirmées — la principale source d'affirmations vraies |
| `videos_depuis_factchecks` | Retrouve dans un article la publication d'origine débunkée |

La boucle de curation en deux temps :

```bash
docker compose exec ai-service python -m app.rag.manche_de_tri
# … on parcourt les clips en jeu, on signale ceux qui clochent …
docker compose exec ai-service python -m app.rag.signalements --ecarter
```

---

## Tester une manche sans passer par le navigateur

Depuis le réseau Docker, en visant le back directement. Utile pour vérifier le
tirage sans ouvrir Chrome.

> Le préfixe de l'API est `/api`, et l'inscription n'accepte **que** `email` et
> `password` — envoyer un `username` provoque un `400`.

```bash
docker compose exec -T ai-service python - <<'EOF'
import httpx, random
s = httpx.Client(base_url="http://backend:3000/api", timeout=60)
suf = random.randint(10000, 99999)
jeton = s.post("/auth/register", json={"email": f"t{suf}@test.local",
                                       "password": "Password123!"}).json()
h = {"Authorization": f"Bearer {jeton.get('accessToken')}"}
salon = s.post("/rooms", json={"name": "Test"}, headers=h).json()["id"]
manche = s.post("/rounds", json={"roomId": salon, "durationSeconds": 300,
                                 "claimCount": 10}, headers=h).json()
for x in manche["roundClaims"]:
    c = x["claim"]
    print(f"[{(c.get('category') or '-'):14s}] {c['text'][:60]}")
EOF
```

Contraintes du back à connaître : `durationSeconds` entre 10 et 3600,
`claimCount` entre 3 et 20 (sauf si on impose la liste via `claimIds`).

---

## Vérifier le service IA

```bash
docker compose exec -T ai-service python -c "
import httpx
r = httpx.post('http://localhost:8000/rag/ask',
               json={'question': \"c'est quoi un deepfake ?\", 'limit': 3}, timeout=90)
print(r.status_code); print(r.text[:300])
"
```

Dans le chat du jeu, l'assistant ne répond que si le message commence par
`@bot` ou `/ask`. Sans ce préfixe, le message part comme un message ordinaire.

---

## Prisma

```bash
docker compose exec backend npx prisma migrate dev --name <nom> --skip-generate
```

> Le conteneur embarque **sa propre copie** du schéma : modifier
> `backend/prisma/schema.prisma` sur l'hôte ne suffit pas, il faut reconstruire
> l'image avant de générer la migration.

Et la migration est créée **dans** le conteneur — il faut la rapatrier pour
qu'elle soit versionnée :

```bash
docker cp "$(docker compose ps -q backend):/app/prisma/migrations/<dossier>" \
  backend/prisma/migrations/
```

---

## Remise à zéro

```bash
docker compose restart              # simple redémarrage
docker compose down -v && docker compose up --build   # ⚠️ efface la base
```

Le `-v` supprime les volumes : comptes, salons **et corpus de clips**. Il faut
ensuite relancer les scripts d'ingestion. À n'utiliser qu'en connaissance de
cause.

Pour ne vider que les parties en gardant le corpus (voir plus bas).

---

## Vérifications d'évaluation

Les commandes qui prouvent chaque exigence du sujet, dans l'ordre où on les
passe. Chacune indique ce qu'elle doit renvoyer.

### Démarrage et services

```bash
docker compose down -v && docker compose up --build   # départ à froid, efface la base
docker compose ps                                     # 5 services, tous healthy
```

### HTTPS et points d'entrée

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/            # 200
curl -sk https://localhost:8443/api/health                                   # {"status":"ok"}
curl -s  -o /dev/null -w '%{http_code}\n' http://localhost:8443/ 2>/dev/null # rien en clair
```

### Validation des entrées

Côté back, en contournant le front. Doit répondre 400 sans créer le compte :

```bash
curl -sk -X POST https://localhost:8443/api/auth/register \
  -H 'Content-Type: application/json' -d '{"email":"pasunemail","password":"a"}'
```

Le `ValidationPipe` global est en `whitelist` + `forbidNonWhitelisted` : un champ
non déclaré dans le DTO fait aussi échouer la requête.

```bash
curl -sk -X POST https://localhost:8443/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.co","password":"Password123!","role":"ADMIN"}'   # 400
```

Les événements WebSocket ne passent pas par ce pipe : ils sont validés à la main
dans `backend/src/realtime/realtime.gateway.ts` (longueur du message, type du
vote, format CUID des identifiants).

### Mots de passe

```bash
docker compose exec -T backend node -e '
const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();
p.user.findFirst({select:{passwordHash:true}}).then(u=>{
  console.log(u.passwordHash);                    // $2b$12$... sel inclus
}).finally(()=>p.$disconnect());'
```

### Services IA

```bash
docker compose exec -T ai-service python -c "
import httpx
print(httpx.post('http://localhost:8000/moderation/check',
      json={'message':'Bonjour'}, timeout=60).json()['action'])          # allow
print(httpx.post('http://localhost:8000/moderation/check',
      json={'message':'I will find you and kill you'}, timeout=60).json()['action'])  # delete
"
```

RAG : la réponse commence par un événement `sources` contenant des URL, puis les
tokens arrivent un par un.

```bash
docker compose exec -T ai-service python -c "
import httpx
r=httpx.post('http://localhost:8000/rag/ask',
             json={'question':'Quelle est la population de la France ?'}, timeout=90)
print(r.text[:400])"
```

LLM libre, même protocole SSE sans récupération de sources. Le limiteur est à 5
appels par 30 s (`LLM_RATE_MAX`, `LLM_RATE_WINDOW`) : six appels d'affilée
déclenchent un 429.

```bash
docker compose exec -T ai-service python -c "
import httpx
for i in range(6):
    r=httpx.post('http://localhost:8000/llm/chat', json={'message':'test'}, timeout=60)
    print(i, r.status_code)"
```

### Deux joueurs simultanés

Deux navigateurs (ou une fenêtre privée), deux comptes, le même salon. Voter en
sens opposé sur chaque clip.

L'invariant à vérifier : chaque clip n'ayant qu'une bonne réponse, la somme des
deux scores doit valoir exactement le nombre de clips, et le pot doit être
conservé — ce que l'un perd, l'autre le gagne. Un écart signalerait une
condition de course dans le règlement de la manche.

Après la manche, le grand livre le confirme :

```bash
docker compose exec -T backend node -e '
const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();
p.transaction.findMany({orderBy:{createdAt:"desc"},take:6,
  select:{amount:true,kind:true,referenceId:true}})
 .then(t=>{console.log(t); console.log("somme:",t.reduce((a,b)=>a+b.amount,0));})
 .finally(()=>p.$disconnect());'
```

### Responsive

`resize_window` est sans effet si la fenêtre est maximisée. On charge chaque
route dans une iframe étroite de la même origine — les media queries y répondent
à la largeur de l'iframe — et on compare le bord droit de chaque élément au
viewport. Le `overflow-x: hidden` du `body` fausse `scrollWidth`, d'où la mesure
élément par élément. Dans la console Chrome :

```js
const f = document.createElement('iframe');
f.width = 320; f.height = 800; f.src = '/'; document.body.appendChild(f);
await new Promise(r => f.onload = r);
const d = f.contentDocument, W = d.documentElement.clientWidth;
[...d.querySelectorAll('body *')]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1; })
  .map(e => e.tagName + ' ' + e.className);        // doit être vide
```

### Console

Parcourir `/`, `/login`, `/play`, `/profile`, `/friends`, `/privacy`, `/terms`
et un salon, onglet Console ouvert, en incluant les états : recherche d'ami,
ajout, vote, fin de manche. Rien ne doit s'afficher.

### Git

```bash
git shortlog -sn origin/main        # commits par auteur
```

### Corpus livré avec le dépôt

Une base fraîchement clonée doit contenir les clips et l'index RAG sans lancer
le moindre script d'ingestion.

```bash
docker compose exec -T ai-service python - <<'EOF'
from app.db import connect
with connect() as c, c.cursor() as cur:
    cur.execute('SELECT count(*) FROM "Claim" WHERE "mediaRef" IS NOT NULL')
    print("clips avec vidéo :", cur.fetchone()[0])
    cur.execute("SELECT count(*) FROM rag.documents")
    print("passages RAG     :", cur.fetchone()[0])
EOF
```

---

## Vider les parties en gardant le corpus

```bash
docker compose exec -T ai-service python - <<'EOF'
from app.db import connect
with connect() as c, c.cursor() as cur:
    for t in ['ClipVote', 'Bet', 'RoundClaim', 'Message', 'Round', 'Room']:
        cur.execute(f'DELETE FROM "{t}"')
        print(f"{t}: {cur.rowcount}")
    c.commit()
EOF
```

L'ordre des tables suit les clés étrangères, des feuilles vers `Room`.
