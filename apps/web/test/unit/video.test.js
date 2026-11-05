import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { vttPath, watchVideoPlay } from '../../src/lib/video.js';

test('vttPath: los subtítulos son el .vtt con el mismo nombre que el video, en la misma carpeta', () => {
  assert.equal(vttPath('/videos/asedio-demo.mp4'), '/videos/asedio-demo.vtt');
  assert.equal(vttPath('/videos/otro-juego.webm'), '/videos/otro-juego.vtt');
  assert.throws(() => vttPath('/videos/sin-extension'), /video/);
  assert.throws(() => vttPath('/otra/ruta.mp4'), /video/);
});

/** Un <video> de mentira: addEventListener con soporte de { once: true }. */
function videoFalso() {
  const emisor = new EventEmitter();
  return {
    addEventListener(tipo, f, opciones) {
      if (opciones?.once) emisor.once(tipo, f);
      else emisor.on(tipo, f);
    },
    play: () => emisor.emit('play'),
    oyentes: () => emisor.listenerCount('play'),
  };
}

test('watchVideoPlay: manda video_play al primer play y no vuelve a mandarlo si se pausa y se reanuda', () => {
  const video = videoFalso();
  const eventos = [];
  watchVideoPlay(video, (nombre) => eventos.push(nombre));
  assert.deepEqual(eventos, [], 'sin reproducir no se manda nada');
  video.play();
  video.play();
  video.play();
  assert.deepEqual(eventos, ['video_play']);
  assert.equal(video.oyentes(), 0, 'el oyente se quita solo tras el primer play');
});

test('watchVideoPlay: sin video en la página no hace nada, y un error al medir no rompe la reproducción', () => {
  assert.doesNotThrow(() => watchVideoPlay(null, () => assert.fail('no debería medir')));
  const video = videoFalso();
  watchVideoPlay(video, () => {
    throw new Error('la medición falló');
  });
  assert.doesNotThrow(() => video.play());
});
