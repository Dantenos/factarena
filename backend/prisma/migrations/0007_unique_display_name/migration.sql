-- Un pseudo enregistré ne peut appartenir qu'à un seul joueur.
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");
