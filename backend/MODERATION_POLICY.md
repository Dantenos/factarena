# Politique de modération

Le backend applique une politique fail-open lorsque le service IA de
modération est indisponible : le message est autorisé, sans wordlist de
secours, et la réponse contient :

```json
{
  "action": "allow",
  "moderation_status": "moderation_unavailable"
}
```

Cette décision évite de présenter une simple liste de mots comme une
modération fiable. Le statut peut être utilisé par la supervision pour mesurer
les messages non modérés et déclencher une revue ultérieure.
