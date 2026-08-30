// pipeline/lib/ollama-client.js
// Client HTTP vers un serveur Ollama LOCAL (http://localhost:11434). Aucune
// donnee ne quitte la machine. Si Ollama n'est pas lance, les erreurs sont
// claires (pas une simple erreur reseau opaque).
"use strict";

const BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";

async function checkOllamaRunning() {
  try {
    const resp = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return { running: false, models: [] };
    const data = await resp.json();
    return { running: true, models: (data.models || []).map(m => m.name) };
  } catch (e) {
    return { running: false, models: [], error: e.message };
  }
}

/** Interroge /api/ps pour savoir si le modele charge tourne sur GPU (size_vram > 0). */
async function checkGpuUsage() {
  try {
    const resp = await fetch(`${BASE_URL}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return { checked: false };
    const data = await resp.json();
    const model = (data.models || [])[0];
    if (!model) return { checked: true, loaded: false };
    return { checked: true, loaded: true, name: model.name, size_vram: model.size_vram || 0, using_gpu: (model.size_vram || 0) > 0 };
  } catch (e) {
    return { checked: false, error: e.message };
  }
}

/** Genere une reponse via Ollama. `jsonSchema` (objet) contraint la sortie via
 * la fonctionnalite "structured outputs" d'Ollama si fournie ; sinon simple
 * mode JSON libre (format:"json"). Limite de temps pour ne jamais bloquer indefiniment. */
async function generate({ model, systemPrompt, userPrompt, temperature = 0.3, timeoutMs = 90000, numPredict = 900, jsonSchema }) {
  const resp = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      format: jsonSchema || "json",
      stream: false,
      options: { temperature, num_predict: numPredict },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Ollama HTTP ${resp.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  const data = await resp.json();
  return data.response || "";
}

module.exports = { checkOllamaRunning, checkGpuUsage, generate, BASE_URL };
