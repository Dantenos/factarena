# Politique du ledger

Les mises utilisent une décrémentation conditionnelle : PostgreSQL n'autorise
la mise que si le solde courant couvre la stake. Deux mises concurrentes sur un
solde insuffisant ne peuvent donc pas toutes les deux réussir.

Les payouts et remboursements portent une `referenceId` unique. Une répétition
avec la même référence est idempotente et ne modifie pas le solde une seconde
fois.

Chaque transaction enregistre `balanceAfter` après la modification atomique du
compte. Le test d'intégration vérifie aussi que la somme des mises et payouts
conserve exactement le pot.

Lancer la vérification PostgreSQL avec :

```bash
npm run test:ledger:integration
```
