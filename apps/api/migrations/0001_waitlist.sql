-- Lista de espera. Cada límite de la especificación (sección 0) está repetido acá en una CHECK, para que ni un bug
-- de la API pueda guardar una fila fuera de rango.
--
-- Sin STRICT (no está verificado en D1): se usa CHECK con typeof(). Los enums viven en las CHECK, así que un valor
-- nuevo en @tienda/contracts exige una migración que reconstruya la tabla (ADR-009); una prueba compara las listas.
-- Los intereses se guardan ordenados como CATEGORIES; que cada elemento sea una categoría lo comprueba contracts,
-- porque SQLite no admite subconsultas dentro de una CHECK.
-- Las marcas de tiempo son ISO-8601 UTC de 24 caracteres: el orden alfabético es el orden cronológico.
-- No hay columnas de IP ni de agente de usuario, a propósito.

CREATE TABLE waitlist (
  id               INTEGER PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE CHECK (typeof(email) = 'text' AND length(email) BETWEEN 5 AND 254
                     AND email = lower(trim(email)) AND instr(email, ' ') = 0
                     AND length(email) - length(replace(email, '@', '')) = 1 AND instr(email, '@') > 1
                     AND instr(substr(email, instr(email, '@') + 1), '.') > 1),
  live_frequency   TEXT NOT NULL CHECK (live_frequency IN ('todavia-no', 'ocasional', 'semanal', 'varias-por-semana', 'diario')),
  stream_type      TEXT NOT NULL CHECK (stream_type IN ('gaming', 'charla', 'musica', 'estudio')),
  interests        TEXT NOT NULL CHECK (json_valid(interests) AND json_type(interests) = 'array'
                     AND json_array_length(interests) BETWEEN 1 AND 4 AND length(interests) <= 48),
  tiktok_user      TEXT CHECK (tiktok_user IS NULL OR (length(tiktok_user) BETWEEN 2 AND 24 AND tiktok_user NOT GLOB '*[^A-Za-z0-9._]*')),
  followers_range  TEXT CHECK (followers_range IS NULL OR followers_range IN ('0-99', '100-999', '1k-9k', '10k-49k', '50k+')),
  country          TEXT CHECK (country IS NULL OR country IN ('ES', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT', 'HN', 'SV', 'NI', 'CU', 'PR', 'US', 'BR', 'ZZ')),
  consent_version  TEXT NOT NULL CHECK (length(consent_version) BETWEEN 2 AND 4 AND consent_version GLOB 'v[0-9]*'
                     AND substr(consent_version, 2) NOT GLOB '*[^0-9]*'),
  consent_at       TEXT NOT NULL CHECK (length(consent_at) = 24 AND consent_at GLOB '????-??-??T??:??:??.???Z'),
  created_at       TEXT NOT NULL CHECK (length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at       TEXT NOT NULL CHECK (length(updated_at) = 24 AND updated_at GLOB '????-??-??T??:??:??.???Z'),
  confirmed_at     TEXT CHECK (confirmed_at IS NULL OR (length(confirmed_at) = 24 AND confirmed_at GLOB '????-??-??T??:??:??.???Z')),
  token_hash       TEXT CHECK (token_hash IS NULL OR (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*')),
  token_expires_at TEXT CHECK (token_expires_at IS NULL OR (length(token_expires_at) = 24 AND token_expires_at GLOB '????-??-??T??:??:??.???Z')),
  recent_sends     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recent_sends) AND json_type(recent_sends) = 'array' AND json_array_length(recent_sends) <= 5),
  CHECK ((token_hash IS NULL) = (token_expires_at IS NULL)),
  CHECK (confirmed_at IS NULL OR token_hash IS NULL)
);

CREATE UNIQUE INDEX waitlist_token_hash ON waitlist (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX waitlist_pending_created ON waitlist (created_at) WHERE confirmed_at IS NULL;
