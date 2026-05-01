const randomSegment = () => Math.random().toString(36).slice(2, 10);

export const generateId = () => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${randomSegment()}${randomSegment()}`;
};
