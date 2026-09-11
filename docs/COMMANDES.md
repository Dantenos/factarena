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


## Vérifications d'évaluation

Les commandes qui prouvent chaque exigence du sujet, dans l'ordre où on les
passe. Chacune indique ce qu'elle doit renvoyer.

### Le bloc à coller en une fois

Après `docker compose up --build`, ceci passe tous les contrôles qui se scriptent.
Le reste (console, responsive, deux joueurs) demande un navigateur et suit plus bas.

```bash
echo "— services —";              docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo "— accueil —";               curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/
echo "— api —";                   curl -sk https://localhost:8443/api/health; echo
echo "— privacy + terms —";       curl -sk -o /dev/null -w '%{http_code} ' https://localhost:8443/privacy
                                  curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/terms
echo "— oauth 42 —";              curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/api/auth/42
echo "— email invalide —";        curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://localhost:8443/api/auth/register \
                                    -H 'Content-Type: application/json' -d '{"email":"pasunemail","password":"a"}'
echo "— champ non déclaré —";     curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://localhost:8443/api/auth/register \
                                    -H 'Content-Type: application/json' -d '{"email":"a@b.co","password":"Pass123!","role":"ADMIN"}'
echo "— injection SQL —";         curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://localhost:8443/api/auth/login \
                                    -H 'Content-Type: application/json' -d '{"email":"x'"'"' OR 1=1--","password":"x"}'
echo "— commits par personne —";  git shortlog -sn origin/main
echo "— corpus livré —";          docker compose exec -T ai-service python -c "
from app.db import connect
with connect() as c, c.cursor() as cur:
    cur.execute('SELECT count(*) FROM \"Claim\" WHERE \"mediaRef\" IS NOT NULL'); print('clips jouables :', cur.fetchone()[0])
    cur.execute('SELECT count(*) FROM rag.documents');                            print('passages RAG   :', cur.fetchone()[0])"
```

Attendu : cinq services `healthy`, `200`, `{"status":"ok"}`, `200 200`, `302`,
trois fois `400`, cinq contributeurs, 50 clips jouables et 1 653 passages.

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

Le filtre sur `passwordHash` n'est pas décoratif : les comptes créés via 42 et les
faux joueurs n'en ont pas, et `findFirst` sans filtre tombe dessus.

```bash
docker compose exec -T backend node -e '
const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();
p.user.findFirst({where:{passwordHash:{not:null}},select:{email:true,passwordHash:true}})
 .then(u=>console.log(u.email,"->",u.passwordHash))   // $2a$12$… 60 caractères, sel inclus
 .finally(()=>p.$disconnect());'
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

