import { useEffect, useRef, useState } from 'react';

import { serializeCircle } from '@shared/ajoEngine.js';
import { LANGUAGES, answerFromFacts, circleFacts, classifyQuestion, reminderNote } from '@shared/alajo.js';

import { useApp } from '../lib/store.jsx';
import { Cta, Drawer } from './ui.jsx';

const QUICK = {
  en: ['Who hasn\'t paid?', 'When is my turn?', 'What happens if I miss?', 'Can anyone run with the pot?'],
  pcm: ['Who never pay?', 'When my turn go reach?', 'Wetin go happen if I no pay?', 'Person fit run with the money?'],
  yo: ['Ta ni kò tíì san?', 'Ìgbà wo ni tèmi?', 'Kí ló máa ṣẹlẹ̀ tí mi ò bá san?', 'Ṣé ẹnikẹ́ni lè sá lọ pẹ̀lú owó?'],
};
const INTENTS = ['unpaid', 'turn', 'miss', 'safety'];

/**
 * Chat with the coordinator. Answers come from /api/alajo (NEAR AI Cloud phrasing
 * facts read from the circle). If the API is unreachable the same facts are
 * answered locally by the shared templates, and the message is labelled as such.
 */
export function AlajoDrawer({ circle, onClose }) {
  const { account, backend, mode, act, toast } = useApp();
  const [lang, setLang] = useState('en');
  const [messages, setMessages] = useState([{ from: 'alajo', text: 'I am Alajo, this circle\'s coordinator. Ask me about payments, turns or what happens if someone misses. I answer from the circle\'s live state.', source: 'rules' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  async function ask(question, intent) {
    if (busy || !question.trim()) return;
    setMessages((list) => [...list, { from: 'user', text: question }]);
    setText('');
    setBusy(true);
    const now = backend.now();
    const facts = circleFacts(circle, { now, account });
    const local = answerFromFacts(facts, intent ?? classifyQuestion(question), lang);
    let reply = { from: 'alajo', text: local, source: 'rules' };
    try {
      const response = await fetch('/api/alajo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circle: JSON.parse(serializeCircle(circle)), account, question, lang, now: now.toString() }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.answer) reply = { from: 'alajo', text: data.answer, source: data.source };
      }
    } catch { /* offline: keep the local answer */ }
    setMessages((list) => [...list, reply]);
    setBusy(false);
  }

  async function postReminder() {
    const note = reminderNote(circleFacts(circle, { now: backend.now() }), lang);
    if (!note) { toast('Nothing to remind: nobody is late on a running round.'); return; }
    try {
      await act('post_note', { circle_id: circle.id, text: note });
      toast('Alajo posted the reminder as a circle note.');
    } catch (error) {
      toast(error.message ?? String(error), 'error');
    }
  }

  return (
    <Drawer title="Ask Alajo" onClose={onClose}>
      <div className="chips" role="group" aria-label="Language">
        {Object.entries(LANGUAGES).map(([code, label]) => (
          <button key={code} type="button" className="chip" aria-pressed={lang === code} onClick={() => setLang(code)}>{label}</button>
        ))}
      </div>
      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <p key={i} className="chat__msg" data-from={m.from}>
            {m.text}
            {m.from === 'alajo' && i > 0 ? <span className="helper" style={{ display: 'block', marginTop: '0.35rem' }}>{m.source === 'near-ai-cloud' ? 'Phrased by NEAR AI Cloud from circle state' : 'Answered from circle state by built-in rules (no model)'}</span> : null}
          </p>
        ))}
        {busy ? <p className="chat__msg skeleton" data-from="alajo" aria-label="Alajo is answering" style={{ width: '60%' }}>&nbsp;</p> : null}
        <span ref={endRef} />
      </div>
      <div className="chips">
        {QUICK[lang].map((q, i) => <button key={q} type="button" className="chip" onClick={() => ask(q, INTENTS[i])}>{q}</button>)}
      </div>
      <form className="chat__form" onSubmit={(event) => { event.preventDefault(); ask(text); }}>
        <label className="sr-only" htmlFor="alajo-q">Your question</label>
        <input id="alajo-q" className="input" style={{ fontFamily: 'var(--font-body)', fontSize: '1rem' }} value={text} maxLength={400} placeholder="Ask about this circle" onChange={(e) => setText(e.target.value)} />
        <Cta type="submit" className="cta--auto" busy={busy}>Ask</Cta>
      </form>
      {mode === 'demo' ? <Cta variant="ghost" size="sm" onClick={postReminder}>Demo: post a reminder note as Alajo</Cta> : null}
      <p className="helper">Alajo can remind, report and settle late rounds. Its NEAR key is a function-call key limited to settle_round, post_note and finalize with zero deposit, so it cannot move funds.</p>
    </Drawer>
  );
}
