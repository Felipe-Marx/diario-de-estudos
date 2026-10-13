import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Act, type AllData, type Flashcard, type Subject } from '../api';

const RATINGS = [
  ['again', 'Errei'],
  ['hard', 'Difícil'],
  ['good', 'Bom'],
  ['easy', 'Fácil'],
] as const;

function isFlashcard(value: unknown): value is Flashcard {
  if (!value || typeof value !== 'object') return false;
  return 'id' in value && typeof value.id === 'number'
    && 'subject_id' in value && typeof value.subject_id === 'number'
    && 'front' in value && typeof value.front === 'string'
    && 'back' in value && typeof value.back === 'string'
    && 'interval_days' in value && typeof value.interval_days === 'number'
    && 'repetitions' in value && typeof value.repetitions === 'number'
    && 'ease_factor' in value && typeof value.ease_factor === 'number'
    && 'next_review_at' in value && typeof value.next_review_at === 'number';
}

function nextReviewLabel(timestamp: number) {
  if (timestamp <= Date.now()) return 'Para revisar agora';
  return 'Próxima revisão: ' + new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp);
}

export default function Flashcards({ cards, subjects, act }: {
  cards: Flashcard[];
  subjects: Subject[];
  act: Act;
}) {
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<number | null>(subjects[0]?.id ?? null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [revealed, setRevealed] = useState(false);
  const temporaryId = useRef(-1);
  const subject = subjects.find((item) => item.id === selectedId) ?? subjects[0];
  const subjectCards = subject ? cards.filter((card) => card.subject_id === subject.id) : [];
  const dueCards = subjectCards
    .filter((card) => card.next_review_at <= now)
    .sort((a, b) => a.next_review_at - b.next_review_at || a.id - b.id);
  const active = dueCards[0];

  useEffect(() => { setRevealed(false); }, [active?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const createCard = (event: FormEvent) => {
    event.preventDefault();
    if (!subject) return;
    const question = front.trim();
    const answer = back.trim();
    if (!question || !answer) return;
    const id = temporaryId.current--;
    setFront('');
    setBack('');
    act(
      () => api<{ id: number }>('POST', '/flashcards', {
        subject_id: subject.id,
        front: question,
        back: answer,
      }),
      (data) => ({
        ...data,
        flashcards: [...data.flashcards, {
          id,
          subject_id: subject.id,
          front: question,
          back: answer,
          interval_days: 0,
          repetitions: 0,
          ease_factor: 2.5,
          next_review_at: 0,
        }],
      }),
      (data, result) => {
        if (!result || typeof result !== 'object' || !('id' in result)) return data;
        const serverId = result.id;
        if (typeof serverId !== 'number') return data;
        return {
          ...data,
          flashcards: data.flashcards.map((card) => card.id === id ? { ...card, id: serverId } : card),
        };
      },
    );
  };

  const review = (rating: typeof RATINGS[number][0]) => {
    if (!active) return;
    const cardId = active.id;
    setRevealed(false);
    act(
      () => api<Flashcard>('PATCH', `/flashcards/${cardId}/review`, { rating }),
      (data) => ({
        ...data,
        flashcards: data.flashcards.map((card) => card.id === cardId
          ? { ...card, next_review_at: Date.now() + 10 * 60 * 1000 }
          : card),
      }),
      (data, result) => isFlashcard(result)
        ? { ...data, flashcards: data.flashcards.map((card) => card.id === result.id ? result : card) }
        : data,
    );
  };

  const removeCard = (id: number) => act(
    () => api('DELETE', `/flashcards/${id}`),
    (data: AllData) => ({ ...data, flashcards: data.flashcards.filter((card) => card.id !== id) }),
  );

  return (
    <>
      <section className="box">
        <h2>Baralho de matéria</h2>
        {subjects.length ? (
          <label className="field">Escolha uma matéria
            <select aria-label="Baralho de matéria" value={subject?.id ?? ''}
              onChange={(event) => { setSelectedId(Number(event.target.value)); setRevealed(false); }}>
              {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        ) : <p className="emp">Crie uma matéria primeiro para plantar seu baralho de cartões.</p>}
      </section>

      {subject && <>
        <section className="box">
          <div className="bar2">
            <h2 style={{ margin: 0 }}>Revisão de hoje</h2>
            <span className="meta">{dueCards.length} {dueCards.length === 1 ? 'cartão para revisar' : 'cartões para revisar'}</span>
          </div>
          {active ? (
            <div className="study-card" aria-live="polite">
              <p className="flashcard-label">Frente</p>
              <p className="flashcard-text">{active.front}</p>
              {revealed ? <>
                <hr />
                <p className="flashcard-label">Verso</p>
                <p className="flashcard-text">{active.back}</p>
                <p className="hint">Como foi lembrar?</p>
                <div className="row">
                  {RATINGS.map(([rating, label]) => (
                    <button key={rating} className={rating === 'easy' ? 'p' : undefined}
                      onClick={() => review(rating)}>{label}</button>
                  ))}
                </div>
              </> : <button className="p" onClick={() => setRevealed(true)}>Mostrar resposta</button>}
            </div>
          ) : subjectCards.length ? (
            <p className="emp">Tudo em dia neste baralho. As próximas revisões aparecem aqui quando chegar a hora.</p>
          ) : (
            <p className="emp">Este baralho ainda está vazio. Adicione seu primeiro cartão abaixo.</p>
          )}
        </section>

        <section className="box">
          <h2>Plantar um cartão</h2>
          <form className="flashcard-form" onSubmit={createCard}>
            <label className="field">Frente
              <textarea className="flashcard-input" value={front} onChange={(event) => setFront(event.target.value)}
                required maxLength={5000} placeholder="Pergunta, conceito ou termo" />
            </label>
            <label className="field">Verso
              <textarea className="flashcard-input" value={back} onChange={(event) => setBack(event.target.value)}
                required maxLength={5000} placeholder="Resposta ou explicação" />
            </label>
            <button className="p" type="submit">Adicionar ao baralho</button>
          </form>
        </section>

        <section className="box">
          <h2>Cartões deste baralho ({subjectCards.length})</h2>
          {subjectCards.length ? (
            <ul className="l">
              {subjectCards.map((card) => (
                <li key={card.id}>
                  <span className="tx"><b>{card.front}</b><br /><span className="meta">{nextReviewLabel(card.next_review_at)}</span></span>
                  <button className="dng" aria-label={`Excluir cartão: ${card.front}`}
                    onClick={() => removeCard(card.id)}>Excluir</button>
                </li>
              ))}
            </ul>
          ) : <p className="emp">Seus cartões aparecerão aqui para você poder organizar o baralho.</p>}
        </section>
      </>}
    </>
  );
}
