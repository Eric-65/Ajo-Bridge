/**
 * POST /api/alajo — ask the coordinator a question about one circle.
 *
 * Body: { circle, account?, question, lang?, now? }
 *   circle   the JSON returned by the contract's get_circle view (or the demo circle, serialised)
 *
 * The answer is grounded in shared/alajo.js facts. With NEAR_AI_API_KEY set, NEAR
 * AI Cloud (OpenAI-compatible, https://cloud-api.near.ai/v1) phrases those facts in
 * English, Pidgin or Yoruba. Without a key, or if the model call fails, the
 * deterministic templates answer and the response says so (`source: "rules"`).
 *
 * This endpoint holds no NEAR key and cannot sign anything.
 */
import { deserializeCircle } from '../shared/ajoEngine.js';
import { LANGUAGES, answerFromFacts, circleFacts, classifyQuestion, factsForPrompt, systemPrompt } from '../shared/alajo.js';

const NEAR_AI_BASE = process.env.NEAR_AI_BASE_URL || 'https://cloud-api.near.ai/v1';
const NEAR_AI_MODEL = process.env.NEAR_AI_MODEL || 'deepseek-ai/DeepSeek-V3.1';

async function askModel({ facts, question, lang }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${NEAR_AI_BASE}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}` },
      body: JSON.stringify({
        model: NEAR_AI_MODEL,
        temperature: 0.3,
        max_tokens: 220,
        messages: [
          { role: 'system', content: systemPrompt(lang) },
          { role: 'user', content: `Circle facts (JSON):\n${JSON.stringify(factsForPrompt(facts))}\n\nMember's question: ${question}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`NEAR AI Cloud answered ${response.status}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('NEAR AI Cloud returned an empty answer');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { circle: raw, account, question, now } = req.body ?? {};
  const lang = Object.hasOwn(LANGUAGES, req.body?.lang) ? req.body.lang : 'en';
  if (!raw || typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'circle and question are required' });
  if (question.length > 400) return res.status(400).json({ error: 'question is too long' });

  let facts;
  try {
    const circle = deserializeCircle(typeof raw === 'string' ? raw : JSON.stringify(raw));
    facts = circleFacts(circle, { now: BigInt(now ?? Date.now() * 1e6), account });
  } catch (error) {
    return res.status(400).json({ error: `could not read circle state: ${error.message}` });
  }

  const fallback = answerFromFacts(facts, classifyQuestion(question), lang);
  if (!process.env.NEAR_AI_API_KEY) return res.status(200).json({ answer: fallback, source: 'rules', lang });
  try {
    const answer = await askModel({ facts, question: question.trim(), lang });
    return res.status(200).json({ answer, source: 'near-ai-cloud', model: NEAR_AI_MODEL, lang });
  } catch (error) {
    return res.status(200).json({ answer: fallback, source: 'rules', lang, modelError: String(error.message ?? error) });
  }
}
