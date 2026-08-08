"""Démo fact-checking : pose des affirmations au RAG et affiche le verdict sourcé.

À lancer le jour de la soutenance pour montrer la surface de vérification.

  # Affirmations intégrées (mix vrai / faux) :
  docker compose exec ai-service python -m app.rag.demo_factcheck

  # Ou tes propres affirmations, en direct (une par argument, entre guillemets) :
  docker compose exec ai-service python -m app.rag.demo_factcheck "La France est en Europe"

RAPPEL HONNÊTE (à dire à l'évaluateur) : ceci est l'ASSISTANT de fact-checking
(analyse sourcée d'une affirmation). Ce n'est PAS l'arbitre du jeu — le score du
jeu vient d'une clé de réponse éditoriale déterministe (docs/ARCHITECTURE.md,
décision n°1). Le RAG EXPLIQUE, il ne tranche jamais le gain. Ne jamais dire
« mon IA détecte les fake news » : dire « mon IA produit une analyse sourcée ».
"""
import asyncio
import json
import os
import sys

import httpx

# Où joindre le service IA. Dans le conteneur : localhost:8000. Réglable si un
# jour on passe par le back (AI_BASE_URL).
BASE_URL = os.getenv("AI_BASE_URL", "http://127.0.0.1:8000")

# Affirmations de démonstration (mix vrai / faux, sur des sujets couverts par le
# corpus). À ÉDITER librement. Le but est de montrer que l'IA rend un verdict
# sourcé — pas de vérifier une « bonne réponse » attendue.
CLAIMS = [
    # --- Affirmations VRAIES ---
    "La Cinquième République française a été instaurée en 1958.",
    "Charles de Gaulle a été le premier président de la Cinquième République.",
    "Emmanuel Macron est président de la République française depuis 2017.",
    "François Mitterrand a été président de la République française.",
    # --- Affirmations FAUSSES ---
    "La France a adopté l'euro comme monnaie en 1985.",                      # en réalité 2002
    "Jacques Chirac a été le premier président de la Cinquième République.",  # c'était de Gaulle
    "Le mandat présidentiel français actuel est de sept ans.",               # 5 ans depuis 2000
    "La Cinquième République a été instaurée en 1975.",                       # 1958
]


def _question(claim: str) -> str:
    # On formule l'affirmation comme une question de vérification.
    return (
        "Cette affirmation est-elle exacte ? Réponds par VRAI ou FAUX, puis "
        f"explique brièvement en te basant sur les passages. Affirmation : {claim}"
    )


async def _factcheck(client: httpx.AsyncClient, claim: str) -> None:
    print("\n" + "=" * 72)
    print(f"AFFIRMATION : {claim}")
    print("-" * 72)
    async with client.stream("POST", f"{BASE_URL}/rag/ask", json={"question": _question(claim)}) as r:
        if r.status_code != 200:
            print(f"  [erreur HTTP {r.status_code}]")
            return
        event = None
        async for line in r.aiter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "sources":
                    titres = ", ".join(s["title"] for s in data[:3]) or "(aucune)"
                    print(f"  Sources : {titres}")
                    print("  Verdict : ", end="", flush=True)
                elif event == "token":
                    # Affichage token par token : la réponse s'écrit en direct.
                    print(data["text"], end="", flush=True)
                elif event == "error":
                    print(f"\n  [erreur : {data.get('message')}]")
        print()


async def main() -> None:
    # Des arguments en ligne de commande remplacent la liste intégrée.
    claims = sys.argv[1:] or CLAIMS
    print(f"Démo fact-checking RAG — {len(claims)} affirmation(s)")
    print("(l'IA analyse et source ; elle N'ARBITRE PAS le jeu — cf. clé de réponse)")
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            for claim in claims:
                await _factcheck(client, claim)
    except httpx.ConnectError:
        print(f"\nService IA injoignable sur {BASE_URL}.")
        print("Lance-le d'abord :  docker compose up -d ai-service")
        sys.exit(1)
    print("\n" + "=" * 72)
    print("Fin de la démo.")


if __name__ == "__main__":
    asyncio.run(main())
