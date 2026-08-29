# Contenu du jeu — items « Vrai ou Fake » (claims vidéo)

Spécification du contenu de pari de FactArena : des affirmations tirées de vidéos,
avec le verdict d'un fact-checkeur identifié. Doc de référence pour le Back Core
(table `Claim`) et le Tech IA (ingestion des fact-checks dans le RAG).

## 1. Concept

> ⚠️ **Révisé (~août 2026) — pivot Option B (lecteur embarqué).** On passe du deep-link à un
> vrai **lecteur vidéo dans la page**. Les points ci-dessous sont à jour ; la **règle d'or
> (§2)** et le **schéma (§3)** ne changent pas — c'est toujours le verdict du fact-checkeur
> qui fait foi.

- Un **item** = un **clip vidéo** (extrait viral) + le **verdict d'un fact-checkeur**
  (AFP Factuel, franceinfo, 20 Minutes…) + un **lien source**.
- **On n'héberge aucune vidéo.** On embarque le **player officiel** de la plateforme (iframe
  YouTube/Facebook de préférence) pointé sur `{id}` + `{start}`/`{end}` ; en base on ne stocke
  que le texte, les timestamps et l'URL. ⚠️ L'embed génère du bruit console tiers : à garder
  sous les domaines plateforme, jamais `localhost` (cf. `ARCHITECTURE.md`, Décision n°2 révisée).
- **Quand ?** Les clips **s'enchaînent pendant la manche** ; le joueur juge chaque clip en
  direct avec **« good news » / « fake news »**, dans une **fenêtre de vote synchronisée** par
  le serveur. Le **verdict + l'explication IA** n'apparaissent **qu'à la révélation** — jamais
  avant, sinon l'IA arbitre le jeu (cf. `ARCHITECTURE.md`, décision n°1).
- Une **manche** = un lot de N clips (mix vrai/faux/trompeur/hors-contexte). **2 boutons
  binaires** : `TROMPEUR` et `HORS_CONTEXTE` comptent comme « fake » ; l'IA apporte la nuance
  à la révélation. Score = **course à la précision** (nombre de clips bien jugés ; le pot va
  au plus juste — PvP à somme nulle).

## 2. Règle d'or (juridique + auditabilité)

**On ne qualifie JAMAIS soi-même les propos d'une personne nommée.** On stocke le
verdict DU fact-checkeur + son lien + sa date. Raisons :
- **Protection juridique** (droit français) : c'est le fact-checkeur qui engage sa
  responsabilité, pas nous.
- **Auditabilité** : chaque verdict est traçable à une source datée → argument de
  soutenance imparable.

C'est aussi pour ça que ce doc **ne contient pas de verdicts pré-remplis** : ils
doivent venir d'un article vérifié, pas d'une supposition.

## 3. Schéma `Claim` (à implémenter côté Prisma — Back Core)

```prisma
enum Verdict {
  VRAI
  FAUX
  TROMPEUR
  IMPRECIS
  HORS_CONTEXTE
}

model Claim {
  id                 String    @id @default(cuid())
  claimText          String              // l'affirmation exacte (ce qu'on montre au joueur)
  claimant           String?             // qui l'a dite (nom)
  speaker            String?             // locuteur si différent du claimant
  verdict            Verdict             // LE verdict du fact-checkeur (jamais le nôtre)
  factcheckUrl       String              // l'article de fact-check = source de vérité
  factcheckPublisher String?             // "AFP Factuel", "franceinfo Vrai ou Faux"...
  reviewDate         DateTime?           // date du fact-check
  videoUrl           String?             // URL de la vidéo (embed du player officiel : {id})
  videoStartS        Int?                // début du segment (s) — point d'entrée du clip
  videoEndS          Int?                // fin du segment (s) — point de sortie (Option B : clips enchaînés)
  archiveUrl         String?             // web.archive.org de l'article (les vidéos meurent)
  category           String?             // "politique_fr" | "viral_debunk" | "cheapfake"
  themeTags          String[]            // mots-thèmes (entités/sujets) pour le garde-fou anti-spoil du bot (ex. ["aigle","bébé"])
  difficulty         Int?                // 1-3, pour équilibrer les lots
  createdAt          DateTime  @default(now())
}
```

> `themeTags` alimente le garde-fou du bot de chat : pendant une manche, si une question
> touche un de ces mots-thèmes, l'IA refuse (elle divulguerait la clé de réponse). À curer
> avec le reste de la fiche — quelques entités/sujets par clip suffisent. Voir `AI.md §9` et
> `ai-service/app/rag/guardrail.py`.

> `verdict` en **enum**, pas un booléen : un item peut être `TROMPEUR` (vrai mais sorti
> de son contexte) — ce sont les meilleurs pour le jeu.

### Frontière avec le RAG
Le `Claim` (relationnel) vit chez **Prisma** (schéma `public`). Si on veut que l'IA
**explique** un verdict, on ingère le **texte de l'article de fact-check** comme document
RAG (`source='factcheck'`) dans le schéma **`rag`** (séparé). Les deux ne se mélangent
pas dans une même table (cf. le bug Prisma/pgvector qu'on a corrigé).

## 4. Comment curer un item (process manuel — le plus fiable pour le MVP)

1. Trouver un fact-check vidéo : **Google FactCheck API**, RSS **franceinfo « Vrai ou
   Faux »**, ou **DE FACTO**.
2. Ouvrir l'article : il donne l'**affirmation**, le **verdict**, et souvent le **lien
   vidéo + le moment** (« à 2:15… »).
3. Remplir une ligne : `claimText`, `verdict` (repris tel quel de l'article),
   `factcheckUrl`, `factcheckPublisher`, `reviewDate`, `videoUrl` + `videoStartS`,
   `category`.
4. **Archiver** l'article (web.archive.org) → `archiveUrl`. Les vidéos disparaissent,
   l'article reste la preuve.

## 5. Équilibrage du lot (garde-fous à respecter à l'ingestion)

1. **~60 % faux / 40 % vrai.** Si tout est faux, le joueur répond toujours « faux » et
   gagne. Le « vrai » est le plus dur à sourcer (les fact-checks publient rarement
   « c'est vrai ») → aller le chercher côté **Vie-publique** (discours vérifiés) et
   dans les cas « citation vraie ≠ contexte faux ».
2. **Quota politique explicite** (équilibre des bords) : la recherche ad hoc remonte un
   panel biaisé. À corriger à l'ingestion, pas après.
3. **Privilégier les cas ambigus** (citation vraie / document faux) : le joueur se
   trompe, et l'IA a une vraie nuance à expliquer.

## 6. Seed à curer (typologies à couvrir)

⚠️ **Colonnes `verdict` / `factcheckUrl` / `videoUrl` à REMPLIR depuis la source
vérifiée** — ne rien inventer (règle d'or, §2). Le tableau ci-dessous fixe les
typologies à couvrir ; le curateur remplit les champs vérifiés.

| # | Sujet / typologie | category | verdict attendu | factcheckUrl | videoUrl (?t=) | themeTags |
|---|---|---|---|---|---|---|
| 1 | Citation authentique dans un document falsifié | politique_fr | FAUX / TROMPEUR | *[à remplir]* | *[à remplir]* | *[selon le clip]* |
| 2 | Affirmation réglementaire fausse (ex. norme UE) | politique_fr | FAUX | *[à remplir]* | *[à remplir]* | `["union européenne","norme","réglementation"]` + le sujet précis |
| 3 | **Élu accusé à tort — il disait vrai** (contre-exemple indispensable) | politique_fr | VRAI | *[à remplir]* | *[à remplir]* | *[selon l'élu / le sujet]* |
| 4 | Image authentique, **audio doublé** | viral_debunk | TROMPEUR | *[à remplir]* | *[à remplir]* | *[selon le sujet de la vidéo]* |
| 5 | Recyclage d'archive + décontextualisation géo | viral_debunk | HORS_CONTEXTE | *[à remplir]* | *[à remplir]* | *[selon le sujet + le lieu]* |
| 6 | Footage de jeu vidéo présenté comme réel (**cheapfake**) | cheapfake | FAUX | *[à remplir]* | *[à remplir]* | `["jeu vidéo","combat","footage"]` + le nom du jeu |
| 7-10 | Discours officiel correctement cité (source Vie-publique) | politique_fr | VRAI | *(article/source)* | *[à remplir]* | *[selon le discours / l'orateur]* |
| 11-15 | Viraux débunkés récents (FactCheck API / franceinfo) | viral_debunk | mix | *[à remplir]* | *[à remplir]* | *[selon le viral]* |

Objectif : **15 items**, ~9 faux/trompeurs/hors-contexte + ~6 vrais, répartis sur les
3 catégories.

### Cas réels ultra-documentés à intégrer (les viraux les plus vus)

En plus des typologies ci-dessus : des cas **réels, célèbres et sûrs** juridiquement
(« cette vidéo est fausse/truquée », pas « tel élu a menti »). Le cas et le verdict
sont établis ; ⚠️ `factcheckUrl` et `videoUrl` **restent à confirmer** — coller le
vrai article + le deep-link (on ne fabrique pas d'URL, §2).

| claimText (le cas) | category | verdict | source à coller | themeTags |
|---|---|---|---|---|
| Des images de **jeu vidéo (Arma 3)** présentées comme un vrai combat (Ukraine / Syrie / Gaza…) | cheapfake | FAUX | AFP Factuel / Reuters — « Arma 3 » | `["arma","jeu vidéo","combat","guerre","footage"]` |
| La vidéo **« un aigle royal attrape un bébé »** (2012) est authentique | viral_debunk | FAUX | canular en images de synthèse (Centre NAD, Montréal) | `["aigle","bébé","rapace","oiseau","parc"]` |
| Une vidéo où **Aya Nakamura** chante pour des dirigeants du Sahel | viral_debunk | FAUX | vidéo **générée par IA** — AFP Factuel | `["aya nakamura","chanteuse","sahel","sommet","concert"]` |
| Une **archive recyclée** présentée comme récente + mauvais pays (« chiens policiers en Espagne » = Afrique du Sud, 1998) | viral_debunk | HORS_CONTEXTE | AFP Factuel | `["chiens","police","espagne","migrants","frontière"]` |

Les cas 1-4 sont des classiques ultra-documentés → parfaits pour la démo. Compléter
ensuite avec des viraux récents via la FactCheck API.

## 7. Ingestion RAG (côté Tech IA)

Pour que l'IA **explique** un verdict au lieu de le deviner : ingérer le **texte de
l'article de fact-check** dans `rag.documents` avec `source='factcheck'` (même pipeline
que les autres sources). À la révélation, `/rag/ask` retrouve l'article et cite la vraie
source (AFP, franceinfo…). Script à écrire : `ingest_factcheck.py`.

## 8. Prochaines briques

1. **Back Core** : créer le modèle `Claim` (§3) + un seed des 15 items curés (§6).
2. **Tech IA** : `ingest_factcheck.py` (articles de fact-check → RAG).
3. **Front/jeu** : afficher l'affirmation (pari) puis le deep-link + verdict + explication
   IA (révélation).
