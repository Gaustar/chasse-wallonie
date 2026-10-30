CREATE TABLE IF NOT EXISTS evt (
  t INTEGER NOT NULL,      -- ms depuis 1970 (UTC)
  appareil TEXT NOT NULL,  -- plus envoyé (« inconnu ») : le nom vient de nom_appareil
  uid TEXT NOT NULL,       -- identifiant local aléatoire du navigateur
  sid TEXT NOT NULL,       -- session (nouvelle après 30 min d'inactivité)
  type TEXT NOT NULL,      -- ouvre | action | fin | erreur
  nom TEXT, detail TEXT, ms INTEGER, ecran TEXT, inst INTEGER, donnees TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS evt_t ON evt (t);
-- Noms donnés à la main depuis la page de consultation.
CREATE TABLE IF NOT EXISTS nom_appareil (uid TEXT PRIMARY KEY, nom TEXT NOT NULL);
-- Ajouté le 2026-10-31 sur la base existante : ALTER TABLE evt ADD COLUMN detail TEXT;
