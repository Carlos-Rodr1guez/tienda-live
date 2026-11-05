// @ts-check

// Punto de entrada del Worker. Por ahora responde 404 a todo: las rutas de /v1 llegan en los próximos lotes.

export default {
  async fetch() {
    return new Response(null, { status: 404 });
  },
};
