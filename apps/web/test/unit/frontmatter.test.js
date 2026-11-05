import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../support/frontmatter.js';

test('frontmatter: escalares, números, booleanos, listas en bloque y en línea, y el cuerpo', () => {
  const { data, body } = parseFrontmatter(
    [
      '---',
      '# un comentario',
      "nombre: 'Juego: uno'",
      'orden: 3',
      'borrador: true',
      'idealPara:',
      '  - gaming',
      '  - charla',
      'otros: [a, b]',
      '---',
      '',
      'Texto del cuerpo.',
    ].join('\n'),
  );
  assert.deepEqual(data, {
    nombre: 'Juego: uno',
    orden: 3,
    borrador: true,
    idealPara: ['gaming', 'charla'],
    otros: ['a', 'b'],
  });
  assert.equal(body.trim(), 'Texto del cuerpo.');
});

test('frontmatter: listas de objetos planos (los regalos) y saltos de línea de Windows', () => {
  const { data } = parseFrontmatter(
    '---\r\nregalos:\r\n  - monedas: "1-9"\r\n    efecto: Un caza\r\n  - monedas: 1000+\r\n    efecto: Un acorazado\r\n---\r\n',
  );
  assert.deepEqual(data.regalos, [
    { monedas: '1-9', efecto: 'Un caza' },
    { monedas: '1000+', efecto: 'Un acorazado' },
  ]);
});

test('frontmatter: lo que no entiende lo rechaza en vez de leerlo mal', () => {
  assert.throws(() => parseFrontmatter('sin frontmatter'), /frontmatter/);
  assert.throws(() => parseFrontmatter('---\nuno: |\n  texto\n---\n'), /no soportado/);
  assert.throws(() => parseFrontmatter('---\nesto no es un par\n---\n'), /no soportada/);
});
