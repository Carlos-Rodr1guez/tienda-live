# ADR-002: Distribución como app de escritorio con Electron

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H0

## Contexto

Hoy ASEDIO necesita Node.js instalado, un `npm install` y Chrome. Un streamer común no va a pasar por eso.

El juego es una página web (Three.js) más un servidor local que recibe el LIVE y lo reenvía por WebSocket. LIVE Studio y OBS lo capturan como una ventana.

## Opciones

| Opción                                              | A favor                                                                                                                       | En contra                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Electron con electron-builder                       | Ventana propia para capturar, instalador y actualizaciones automáticas. Reusa el código web y el servidor de Node sin cambios | Instalador grande, porque trae Chromium. Hay que firmar el ejecutable                                            |
| Ejecutable de Node (SEA) y el navegador del sistema | Liviano                                                                                                                       | Depende del navegador de cada uno. No trae actualizaciones automáticas                                           |
| Tauri                                               | Instalador chico                                                                                                              | Usa el WebView del sistema, con un WebGL más variable. El servidor de Node iría aparte o habría que reescribirlo |
| Versión en la nube, como fuente de navegador        | Nada que instalar                                                                                                             | Infraestructura y costo por directo desde el primer día                                                          |

## Decisión propuesta

Electron con electron-builder, para Windows primero, que es donde transmite la mayoría de los streamers. La versión en la nube queda para el H6, cuando haya ingresos que paguen esa infraestructura.

## Consecuencias

- Sin firma de código, Windows muestra la advertencia de SmartScreen al instalar. El certificado es un costo anual que entra en el H2.
- Las actualizaciones se publican en Cloudflare R2, con GitHub Releases como plan B, y la app verifica cada una antes de instalarla.
- El servidor local sigue igual. Por eso la CI ya corre las pruebas en Windows desde el H0.
