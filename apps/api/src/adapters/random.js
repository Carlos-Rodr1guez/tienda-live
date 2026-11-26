// @ts-check
// Bytes aleatorios criptográficos (los de los tokens). Las pruebas pasan uno determinista.

/** @returns {import('../ports.js').Random} */
export function createRandom() {
  return {
    bytes(n) {
      const bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      return bytes;
    },
  };
}
