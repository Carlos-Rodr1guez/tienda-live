-- Contadores del embudo: una fila por día (UTC) y evento. No guarda nada de quien hace el pedido.
-- El evento no tiene lista cerrada acá: agregar uno es editar solo @tienda/contracts (FM-2).

CREATE TABLE funnel_daily (
  day   TEXT NOT NULL CHECK (length(day) = 10 AND day GLOB '????-??-??'),
  event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 32 AND event NOT GLOB '*[^a-z_]*'),
  count INTEGER NOT NULL CHECK (typeof(count) = 'integer' AND count BETWEEN 1 AND 100000),
  PRIMARY KEY (day, event)
);
