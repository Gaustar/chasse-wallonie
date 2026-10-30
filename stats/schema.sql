CREATE TABLE IF NOT EXISTS evt (
  t INTEGER NOT NULL,      -- ms depuis 1970 (UTC)
  appareil TEXT NOT NULL,  -- étiquette posée par ?appareil=…
  uid TEXT NOT NULL,       -- identifiant local aléatoire du navigateur
  sid TEXT NOT NULL,       -- session (nouvelle après 30 min d'inactivité)
  type TEXT NOT NULL,      -- ouvre | action | fin | erreur
  nom TEXT, ms INTEGER, ecran TEXT, inst INTEGER, donnees TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS evt_t ON evt (t);
