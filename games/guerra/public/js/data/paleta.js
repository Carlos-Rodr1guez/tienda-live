// Paleta de 8 colores para los equipos, pensada para el fondo oscuro del campo (diseño D26, §12.3).
// Solo datos: el orden es el que usa el respaldo de la elección de colores (rangos 3 a 7).

/** Texto de los chips y contorno de las unidades. */
const INK = '#0B0F17';

const COLORS = [
  { id: 'rojo', hex: '#E5484D' },
  { id: 'naranja', hex: '#FF8B3D' },
  { id: 'oro', hex: '#F5C518' },
  { id: 'verde', hex: '#2FBF71' },
  { id: 'celeste', hex: '#5BC8F5' },
  { id: 'azul', hex: '#3B7BFF' },
  { id: 'morado', hex: '#A86BFF' },
  { id: 'blanco', hex: '#EEF2F7' },
];

// Colores del terreno por donde caminan las unidades. Todos con luminancia relativa <= 0,039 para que cada
// color de equipo conserve 3:1 de contraste: los dos retonos (#2E393A y #3B3544) salen de ese techo.
const TERRAIN = [
  { id: 'fondo', hex: '#2A3436' },
  { id: 'parche', hex: '#2E393A' },
  { id: 'huella', hex: '#3B3544' },
  { id: 'mancha', hex: '#3A3542' },
  { id: 'sombra', hex: '#232C2F' },
];

export const PALETA = Object.freeze({
  ink: INK,
  colors: Object.freeze(COLORS.map((c) => Object.freeze(c))),
  terrain: Object.freeze(TERRAIN.map((c) => Object.freeze(c))),
  /** Techo de luminancia relativa para todo color de superficie transitable. */
  terrainMaxLuminance: 0.039,
});
