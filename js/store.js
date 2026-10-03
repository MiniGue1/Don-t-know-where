// On-device persistence. Everything stays in the browser's localStorage.

const KEYS = {
  history: "dkw.history.v1",
  settings: "dkw.settings.v1",
  activeTrip: "dkw.activeTrip.v1",
};

export function createStore(storage = globalThis.localStorage) {
  const read = (key, fallback) => {
    try {
      const raw = storage?.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      if (value == null) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false; // quota exceeded / private mode
    }
  };

  return {
    getHistory: () => read(KEYS.history, []),
    addTrip(trip) {
      const history = read(KEYS.history, []);
      history.unshift(trip);
      if (!write(KEYS.history, history)) {
        // Out of space: drop GPS detail from the oldest trips and retry.
        for (let i = history.length - 1; i > 0 && history[i].track?.length; i--) history[i].track = [];
        write(KEYS.history, history);
      }
      return history;
    },
    deleteTrip(id) {
      const history = read(KEYS.history, []).filter((t) => t.id !== id);
      write(KEYS.history, history);
      return history;
    },
    clearHistory: () => write(KEYS.history, null),
    getSettings: (defaults) => ({ ...defaults, ...read(KEYS.settings, {}) }),
    saveSettings: (s) => write(KEYS.settings, s),
    getActiveTrip: () => read(KEYS.activeTrip, null),
    saveActiveTrip: (t) => write(KEYS.activeTrip, t),
  };
}
