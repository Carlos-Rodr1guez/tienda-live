// @ts-check
// Punto de entrada del navegador para el beacon: lo carga el diseño base en todas las páginas. El token se reemplaza al
// construir (import.meta.env.PUBLIC_*): si no hay, la condición es constante y el módulo del beacon ni se incluye en el
// sitio, así que sin token no queda en ningún archivo el origen de Cloudflare. Con token, beacon.js decide al ejecutarse
// si corresponde (analítica encendida en la página y fuera de /confirmar).

const token = import.meta.env.PUBLIC_CF_BEACON_TOKEN;

if (token) {
  import('./beacon.js').then(({ injectBeacon }) => injectBeacon({ token, doc: document, pathname: location.pathname }));
}
