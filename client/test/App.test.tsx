import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/auth';
import type { AllData, User } from '../src/api';
import { today } from '../src/lib';

const user: User = {
  id: 1,
  email: 'estudante@example.test',
  username: 'Estudante',
  avatarMode: 'character',
  avatarImage: null,
  character: { skin: 1, hair: 1, hc: 1, shirt: 0, style: 0, acc: 0, ac: 2, bg: 0 },
  hasPassword: true,
};

let data: AllData;
let currentUser: User;
let requests: Array<{ method: string; path: string; body: unknown }>;
let rejectNextMutation: string | null;
let nextTaskMutationGate: Promise<void> | null;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recalculateProgress() {
  data.projects = data.projects.map((project) => {
    const tasks = data.tasks.filter((task) => task.project_id === project.id);
    const completed = tasks.filter((task) => task.done).length;
    return { ...project, progress: tasks.length ? Math.round(completed / tasks.length * 100) : 0 };
  });
}

function renderApp() {
  return render(<AuthProvider><App /></AuthProvider>);
}

beforeEach(() => {
  currentUser = { ...user, character: { ...user.character } };
  data = { subjects: [], tasks: [], projects: [], flashcards: [], sessions: {} };
  requests = [];
  rejectNextMutation = null;
  nextTaskMutationGate = null;

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/api', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ method, path, body });

    if (method !== 'GET' && rejectNextMutation) {
      const message = rejectNextMutation;
      rejectNextMutation = null;
      return response({ error: message }, 400);
    }
    if (path.startsWith('/tasks') && nextTaskMutationGate) {
      const gate = nextTaskMutationGate;
      nextTaskMutationGate = null;
      await gate;
    }

    if (method === 'GET' && path === '/me') return response(currentUser);
    if (method === 'GET' && path === '/all') return response(data);
    if (method === 'POST' && path === '/auth/logout') return response({});
    if (method === 'POST' && path === '/sessions') {
      const day = String(body.day);
      data.sessions[day] = (data.sessions[day] || 0) + Number(body.minutes);
      return response({});
    }
    if (method === 'POST' && path === '/subjects') {
      const subject = { id: Date.now(), name: String(body.name), color: '#A8D68B', notes: '' };
      data.subjects.push(subject);
      return response({ id: subject.id });
    }
    if (method === 'POST' && path === '/flashcards') {
      const card = {
        id: Date.now(),
        subject_id: Number(body.subject_id),
        front: String(body.front),
        back: String(body.back),
        interval_days: 0,
        repetitions: 0,
        ease_factor: 2.5,
        next_review_at: 0,
      };
      data.flashcards.push(card);
      return response({ id: card.id });
    }
    if (method === 'PATCH' && path.endsWith('/review')) {
      const id = Number(path.split('/')[2]);
      const card = data.flashcards.find((item) => item.id === id);
      if (!card) return response({ error: 'Cartão não encontrado' }, 404);
      const quality = body.rating === 'again' ? 1 : body.rating === 'hard' ? 3 : body.rating === 'good' ? 4 : 5;
      const repetitions = quality < 3 ? 0 : card.repetitions + 1;
      const intervalDays = quality < 3 ? 0 : repetitions === 1 ? 1 : repetitions === 2 ? 6
        : Math.max(1, Math.round(card.interval_days * card.ease_factor));
      const updated = {
        ...card,
        repetitions,
        interval_days: intervalDays,
        ease_factor: Math.max(1.3, card.ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
        next_review_at: Date.now() + (intervalDays ? intervalDays * 86_400_000 : 600_000),
      };
      data.flashcards = data.flashcards.map((item) => item.id === id ? updated : item);
      return response(updated);
    }
    if (method === 'DELETE' && path.startsWith('/flashcards/')) {
      const id = Number(path.split('/').pop());
      data.flashcards = data.flashcards.filter((card) => card.id !== id);
      return response({});
    }
    if (method === 'DELETE' && path.startsWith('/subjects/')) {
      const id = Number(path.split('/').pop());
      data.subjects = data.subjects.filter((subject) => subject.id !== id);
      data.tasks = data.tasks.map((task) => task.subject_id === id ? { ...task, subject_id: null } : task);
      return response({});
    }
    if (method === 'PUT' && path.startsWith('/subjects/')) {
      const id = Number(path.split('/').pop());
      data.subjects = data.subjects.map((subject) =>
        subject.id === id ? { ...subject, notes: String(body.notes ?? subject.notes) } : subject);
      return response({});
    }
    if (method === 'POST' && path === '/tasks') {
      const task = {
        id: Date.now(),
        title: String(body.title),
        subject_id: typeof body.subject_id === 'number' ? body.subject_id : null,
        project_id: typeof body.project_id === 'number' ? body.project_id : null,
        due: String(body.due ?? ''),
        done: 0,
      };
      data.tasks.push(task);
      recalculateProgress();
      return response({ id: task.id });
    }
    if (method === 'PATCH' && path.startsWith('/tasks/')) {
      const id = Number(path.split('/').pop());
      data.tasks = data.tasks.map((task) => task.id === id
        ? {
            ...task,
            ...(typeof body.done === 'boolean' ? { done: body.done ? 1 : 0 } : {}),
            ...(Object.prototype.hasOwnProperty.call(body, 'project_id')
              ? { project_id: typeof body.project_id === 'number' ? body.project_id : null }
              : {}),
          }
        : task);
      recalculateProgress();
      return response({});
    }
    if (method === 'DELETE' && path.startsWith('/tasks/')) {
      const id = Number(path.split('/').pop());
      data.tasks = data.tasks.filter((task) => task.id !== id);
      recalculateProgress();
      return response({});
    }
    if (method === 'POST' && path === '/projects') {
      const project = { id: Date.now(), name: String(body.name), progress: 0 };
      data.projects.push(project);
      return response({ id: project.id });
    }
    if (method === 'DELETE' && path.startsWith('/projects/')) {
      const id = Number(path.split('/').pop());
      data.projects = data.projects.filter((project) => project.id !== id);
      data.tasks = data.tasks.map((task) => task.project_id === id ? { ...task, project_id: null } : task);
      recalculateProgress();
      return response({});
    }
    if (method === 'PUT' && path === '/me') {
      currentUser = { ...currentUser, ...body } as User;
      return response(currentUser);
    }
    return response({ error: `Rota sem mock: ${method} ${path}` }, 404);
  }));
});

describe('fluxos principais da interface', () => {
  it('cria cartão e agenda a próxima revisão conforme a avaliação', async () => {
    const user = userEvent.setup();
    data.subjects = [{ id: 10, name: 'Biologia', color: '#A8D68B', notes: '' }];
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Cartões' }));

    await user.type(screen.getByRole('textbox', { name: 'Frente' }), 'O que é mitose?');
    await user.type(screen.getByRole('textbox', { name: 'Verso' }), 'Divisão celular.');
    await user.click(screen.getByRole('button', { name: 'Adicionar ao baralho' }));

    expect(await screen.findByText('O que é mitose?', { selector: '.flashcard-text' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    expect(screen.getByText('Divisão celular.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Bom' }));

    await waitFor(() => {
      expect(data.flashcards[0]).toMatchObject({ repetitions: 1, interval_days: 1 });
      expect(screen.getByText('Tudo em dia neste baralho. As próximas revisões aparecem aqui quando chegar a hora.')).not.toBeNull();
    });
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/flashcards',
      body: { subject_id: 10, front: 'O que é mitose?', back: 'Divisão celular.' },
    });
    expect(requests).toContainEqual({
      method: 'PATCH',
      path: `/flashcards/${data.flashcards[0].id}/review`,
      body: { rating: 'good' },
    });
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
  });

  it('navega pelas seções e cria uma matéria em uma conta vazia', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole('heading', { name: /Estudante/ })).not.toBeNull();
    expect(screen.getByText('Nada pendente por enquanto. Respire fundo e aproveite o dia.')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Matérias' }));
    expect(screen.getByText('Plante sua primeira matéria acima.')).not.toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Nome da nova matéria' }), 'Cálculo');
    await user.click(screen.getByRole('button', { name: 'Plantar matéria' }));

    expect(await screen.findByRole('heading', { name: 'Cálculo' })).not.toBeNull();
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/subjects',
      body: { name: 'Cálculo' },
    });
  });

  it('registra os minutos focados ao pausar e atualiza o total do dia', async () => {
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
      vi.useRealTimers();

      await waitFor(() => {
        expect(requests).toContainEqual({
          method: 'POST',
          path: '/sessions',
          body: { minutes: 3, day: today() },
        });
      });
      expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
      expect(screen.getByText('3', { selector: 'p.big' })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('salva notas após o debounce e permite visualizar Markdown', async () => {
    data.subjects = [{ id: 10, name: 'Biologia', color: '#A8D68B', notes: '' }];
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    fireEvent.click(screen.getByRole('button', { name: 'Matérias' }));
    const notes = await screen.findByRole('textbox', { name: 'Notas em Markdown' });

    vi.useFakeTimers();
    try {
      fireEvent.change(notes, { target: { value: '**mitose**' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/subjects/10',
        body: { notes: '**mitose**' },
      });
      expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Visualizar' }));
      expect(screen.getByText('mitose').tagName).toBe('B');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cria tarefa vinculada, conclui e move entre projetos atualizando o progresso', async () => {
    const user = userEvent.setup();
    data.subjects = [{ id: 10, name: 'Biologia', color: '#A8D68B', notes: '' }];
    data.projects = [
      { id: 20, name: 'Projeto A', progress: 0 },
      { id: 21, name: 'Projeto B', progress: 0 },
    ];
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Tarefas' }));

    await user.type(screen.getByRole('textbox', { name: 'Tarefa' }), 'Ler capítulo');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Matéria' }), '10');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Projeto' }), '20');
    await user.click(screen.getByRole('button', { name: 'Adicionar tarefa' }));

    const checkbox = await screen.findByRole('checkbox', { name: 'Concluir tarefa: Ler capítulo' });
    expect(data.tasks[0]).toMatchObject({ title: 'Ler capítulo', subject_id: 10, project_id: 20, done: 0 });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Projeto de Ler capítulo' }), '21');
    await waitFor(() => {
      expect(data.projects[0].progress).toBe(0);
      expect(data.projects[1].progress).toBe(0);
    });

    await user.click(checkbox);
    await waitFor(() => expect(data.projects[1].progress).toBe(100));
    await user.click(screen.getByRole('button', { name: 'Hoje' }));
    const progress = screen.getByRole('progressbar', { name: 'Progresso de Projeto B' });
    expect(progress.getAttribute('aria-valuenow')).toBe('100');
    await user.click(screen.getByRole('button', { name: 'Tarefas' }));
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Reabrir tarefa: Ler capítulo' }));
    await waitFor(() => expect(data.projects[1].progress).toBe(0));

    expect(requests).toContainEqual({
      method: 'POST',
      path: '/tasks',
      body: { title: 'Ler capítulo', subject_id: 10, project_id: 20, due: '' },
    });
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
  });

  it('cria projeto imediatamente sem recarregar todos os dados', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.type(screen.getByRole('textbox', { name: 'Nome do projeto' }), 'Projeto local');
    await user.click(screen.getByRole('button', { name: 'Plantar projeto' }));

    expect(await screen.findByText('Projeto local')).not.toBeNull();
    expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/projects' }));
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
  });

  it('remove matéria sem recarregar dados completos e desvincula as tarefas', async () => {
    const user = userEvent.setup();
    data.subjects = [{ id: 10, name: 'Biologia', color: '#A8D68B', notes: '' }];
    data.tasks = [{ id: 30, title: 'Ler capítulo', subject_id: 10, project_id: null, due: '', done: 0 }];
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Matérias' }));
    await user.click(screen.getByRole('button', { name: 'Excluir matéria' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));

    expect(await screen.findByText('Plante sua primeira matéria acima.')).not.toBeNull();
    expect(data.tasks[0].subject_id).toBeNull();
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
  });

  it('remove projeto imediatamente e desvincula tarefas sem recarregar dados completos', async () => {
    const user = userEvent.setup();
    data.projects = [{ id: 20, name: 'Projeto de estudo', progress: 0 }];
    data.tasks = [{ id: 30, title: 'Ler capítulo', subject_id: null, project_id: 20, due: '', done: 0 }];
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText('Plante um projeto e veja ele crescer conforme o progresso.')).not.toBeNull();
    expect(data.tasks[0].project_id).toBeNull();
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
  });

  it('mostra uma tarefa imediatamente enquanto a API ainda está respondendo', async () => {
    const user = userEvent.setup();
    let releaseMutation: (() => void) | undefined;
    nextTaskMutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Tarefas' }));
    await user.type(screen.getByRole('textbox', { name: 'Tarefa' }), 'Revisar anotações');

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tarefa' }));

    expect(screen.getByRole('checkbox', { name: 'Concluir tarefa: Revisar anotações' })).not.toBeNull();
    expect(data.tasks).toHaveLength(0);
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);

    await act(async () => { releaseMutation?.(); });
    await waitFor(() => expect(data.tasks).toHaveLength(1));
    expect(screen.getByRole('checkbox', { name: 'Concluir tarefa: Revisar anotações' })).not.toBeNull();
    expect(requests.filter((request) => request.method === 'GET' && request.path === '/all')).toHaveLength(1);
  });

  it('atualiza conclusão e progresso do projeto imediatamente na aba Hoje', async () => {
    data.tasks = [{ id: 30, title: 'Ler resumo', subject_id: null, project_id: 20, due: '', done: 0 }];
    data.projects = [{ id: 20, name: 'Projeto de leitura', progress: 0 }];
    let releaseMutation: (() => void) | undefined;
    nextTaskMutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Concluir tarefa: Ler resumo' }));

    expect(screen.getByText('Nada pendente por enquanto. Respire fundo e aproveite o dia.')).not.toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Progresso de Projeto de leitura' }).getAttribute('aria-valuenow')).toBe('100');
    expect(data.tasks[0].done).toBe(0);

    await act(async () => { releaseMutation?.(); });
    await waitFor(() => expect(data.tasks[0].done).toBe(1));
  });

  it('reverte uma tarefa otimista e mostra o erro se a API rejeitar a criação', async () => {
    const user = userEvent.setup();
    rejectNextMutation = 'Falha ao criar tarefa.';
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Tarefas' }));
    await user.type(screen.getByRole('textbox', { name: 'Tarefa' }), 'Tarefa que vai falhar');

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tarefa' }));
    expect(screen.getByRole('checkbox', { name: 'Concluir tarefa: Tarefa que vai falhar' })).not.toBeNull();

    expect((await screen.findByRole('alert')).textContent).toContain('Falha ao criar tarefa.');
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Concluir tarefa: Tarefa que vai falhar' })).toBeNull());
  });

  it('permite escolher opções do personagem pelo teclado e salvar o perfil', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });
    await user.click(screen.getByRole('button', { name: 'Perfil' }));

    const skin = within(screen.getByRole('radiogroup', { name: 'Pele' }));
    const selected = skin.getByRole('radio', { name: 'Tom de pele 2' });
    selected.focus();
    fireEvent.keyDown(selected, { key: 'End' });

    const finalSkin = skin.getByRole('radio', { name: 'Tom de pele 5' });
    expect(finalSkin.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(finalSkin);

    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Perfil salvo!'));
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'PUT',
      path: '/me',
      body: expect.objectContaining({
        username: 'Estudante',
        character: expect.objectContaining({ skin: 4 }),
      }),
    }));
  });

  it('mostra ao usuário o erro de uma ação que falhou', async () => {
    const user = userEvent.setup();
    rejectNextMutation = 'Não foi possível plantar o projeto.';
    renderApp();
    await screen.findByRole('heading', { name: /Estudante/ });

    await user.type(screen.getByRole('textbox', { name: 'Nome do projeto' }), 'Projeto');
    await user.click(screen.getByRole('button', { name: 'Plantar projeto' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível plantar o projeto.');
  });
});
