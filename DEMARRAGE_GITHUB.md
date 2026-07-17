# Démarrage GitHub — à lire puis SUPPRIMER de l'historique une fois fait

## 1. Créer le repo sur GitHub

- **Nom** : `ft_transcendence` (convention 42 — les évaluateurs et recruteurs le reconnaissent au premier coup d'œil)
- **Description** : `FactArena — real-time fact-checking & betting platform. 42 school final Common Core project (ft_transcendence).`
- **Visibilité** : private pendant le développement (passez-le public après la soutenance pour vos CV)
- Ne PAS cocher "Add README" ni "Add .gitignore" : tout est déjà dans ce kit

## 2. Réglages du repo (Settings)

- Branches → règle sur `main` : exiger une Pull Request + 1 approbation avant merge, interdire le push direct
- Collaborators → inviter les 4 mates immédiatement
- General → activer Issues (votre outil de gestion de projet, exigé implicitement par le README "Project Management")

## 3. Premiers commits — L'ORDRE ET LES AUTEURS COMPTENT

Le sujet vérifie que TOUS les membres commitent. Ne fais PAS tout toi-même :
toi tu poses le socle (commits 1-3), puis CHAQUE mate fait son premier commit
sur son territoire dès le jour 1.

```bash
cd ft_transcendence
git init
git add .gitignore .env.example
git commit -m "chore(repo): gitignore et .env.example (secrets hors git, exigence du sujet)"

git add README.md docs/
git commit -m "docs(readme): squelette README conforme au chapitre VI + architecture cible"

git add frontend/ backend/ ai-service/ nginx/
git commit -m "chore(repo): structure monorepo, un territoire par service"

git add docker-compose.yml docker-compose.dev.yml postgres/
git commit -m "feat(infra): dockerisation complete — 5 services, HTTPS/WSS, pgvector, mode dev"

git branch -M main
git remote add origin git@github.com:<user>/ft_transcendence.git
git push -u origin main
```

Puis chaque mate, le jour même, sur sa branche :
- Back Core : `feat(backend): initialisation NestJS + healthcheck`
- IA : `feat(ai-service): initialisation FastAPI + healthcheck`
- Front UI : `feat(frontend): initialisation Vite/React + routeur`
- DevOps : `feat(infra): docker-compose 5 services + nginx HTTPS`

## 4. Ne pas oublier

- Placer le PDF du sujet dans docs/ (remplace PLACER_LE_SUJET_ICI.md)
- Remplacer les <login> du README par vos vrais logins 42
- Supprimer ce fichier une fois le repo lancé : `git rm DEMARRAGE_GITHUB.md`
