// api/index.js
// Point d'entree Vercel — enveloppe l'app Express EXISTANTE sans dupliquer
// la moindre logique de route. Toutes les routes (/api/health, /api/search,
// /api/feedback, fichiers statiques) restent definies UNIQUEMENT dans
// server/prototype-v3-server.js.
"use strict";
const { createApp } = require("../server/prototype-v3-server");

module.exports = createApp();
