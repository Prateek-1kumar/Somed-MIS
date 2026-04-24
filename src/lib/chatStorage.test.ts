import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildInitialState,
  type ChatState,
} from './chatStorage';

describe('chatStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null when nothing stored', () => {
    expect(loadChatState()).toBeNull();
  });

  it('round-trips state', () => {
    const state: ChatState = {
      messages: [{ id: 'u1', role: 'user', text: 'hello', createdAt: 1 }],
      sessionStartedAt: 42,
      dataVersion: 7,
    };
    saveChatState(state);
    const loaded = loadChatState();
    expect(loaded).toEqual(state);
  });

  it('clear wipes state', () => {
    saveChatState(buildInitialState());
    clearChatState();
    expect(loadChatState()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    sessionStorage.setItem('somed_chat_v1', '{not-valid');
    expect(loadChatState()).toBeNull();
  });

  it('returns null when shape is wrong', () => {
    sessionStorage.setItem('somed_chat_v1', JSON.stringify({ messages: 'not-an-array' }));
    expect(loadChatState()).toBeNull();
  });

  it('buildInitialState picks up current dataVersion from localStorage', () => {
    localStorage.setItem('dataVersion', '42');
    const s = buildInitialState();
    expect(s.dataVersion).toBe(42);
    expect(s.messages).toEqual([]);
  });

  it('buildInitialState handles missing dataVersion', () => {
    localStorage.removeItem('dataVersion');
    const s = buildInitialState();
    expect(s.dataVersion).toBe(0);
  });
});
