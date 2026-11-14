export const createAuthStateStore = ({ now = () => Date.now(), ttlMs = 10 * 60 * 1000 } = {}) => {
  const issuedStates = new Map();

  return {
    issue(state, metadata = {}) {
      issuedStates.set(state, { ...metadata, expiresAt: now() + ttlMs });
    },
    consume(state, expected = {}) {
      const record = issuedStates.get(state);
      if (!record || record.expiresAt <= now()) {
        issuedStates.delete(state);
        return false;
      }

      for (const [key, value] of Object.entries(expected)) {
        if (value !== undefined && record[key] !== value) {
          return false;
        }
      }

      issuedStates.delete(state);
      return record;
    },
  };
};
