// @ts-check
// Marca en un solo lugar: las páginas y el correo la leen de acá. Cambiar el nombre acá lo cambia en todos lados.
// El nombre es provisorio (ver README). Un campo en null se muestra como "pendiente".

export const BRAND = Object.freeze({
  name: 'Tienda LIVE',
  tagline: 'Juegos interactivos para tu LIVE de TikTok',
  siteUrlDefault: 'http://localhost:8790',
  /** @type {string | null} */
  contactEmail: null,
  /** @type {string | null} */
  legalEntity: null,
});
