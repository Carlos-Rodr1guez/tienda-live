// @ts-check
// Punto de entrada del navegador para la portada y las fichas: arranca el formulario (si la página lo trae) y mide la
// primera reproducción del video (si la página tiene uno). Todo lo demás de la página es HTML y CSS sin JavaScript.

import { createAnalytics, isTrackedPath } from './analytics.js';
import { initFormPage } from './form/controller.js';
import { watchVideoPlay } from './video.js';

initFormPage();

const video = document.querySelector('video[data-seguimiento="video"]');
if (video) {
  const analytics = createAnalytics({
    enabled: document.documentElement.dataset.analytics === 'on' && isTrackedPath(location.pathname),
  });
  watchVideoPlay(video, (nombre) => analytics.track(nombre));
}
