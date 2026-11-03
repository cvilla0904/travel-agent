/**
 * Normalización de precios de actividades (Apify: Civitatis / Tiqets).
 *
 * Lógica movida desde la herramienta buscar_actividades para poder probarla
 * sin cargar el SDK de agentes. La única diferencia de comportamiento es que
 * las expresiones regulares del respaldo textual estaban escritas con doble
 * barra invertida dentro de literales (`\\s`, `\\d`, `\\b`), que buscan una barra
 * literal y NUNCA coincidían con "Desde 19,90 €" ni con "gratis".
 *
 * Reglas que se conservan:
 *  - 0 NO equivale a gratis: solo lo es si el proveedor lo marca (isFree/free/
 *    is_free) o lo dice en un texto de precio y no hay importe numérico.
 *  - Precio ausente = null (desconocido), nunca 0.
 *  - Es un precio "desde" orientativo; no se convierte en precio final.
 */

export function parsearPrecio(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor;
  if (typeof valor === 'string' && valor.trim()) {
    const limpio = valor.trim().replace(/[^0-9,.-]/g, '').replace(',', '.');
    // Un texto sin cifras (p. ej. "Consultar") quedaría como '' y Number('') es 0: no es un precio.
    if (!/\d/.test(limpio)) return null;
    const numero = Number(limpio);
    if (Number.isFinite(numero) && numero >= 0) return numero;
  }
  return null;
}

const CAMPOS_TEXTO_PRECIO = ['priceText', 'priceLabel', 'priceDescription'] as const;

export function extraerPrecio(actividad: any): number | null {
  // Los datasets del scraper pueden nombrar la tarifa de varias formas.
  // Priorizamos siempre el campo explícito de precio desde.
  const candidatos = [actividad?.priceFrom, actividad?.price, actividad?.amount, actividad?.fromPrice, actividad?.startingPrice];
  for (const candidato of candidatos) {
    const parsed = parsearPrecio(candidato);
    if (parsed !== null) return parsed;
  }
  // Respaldo para textos tipo "Desde 19,90 €".
  const texto = CAMPOS_TEXTO_PRECIO.map((campo) => actividad?.[campo]).find((v) => typeof v === 'string' && v.trim());
  if (typeof texto === 'string') {
    const match = texto.match(/(?:desde\s*)?(\d[\d.,]*)\s*(?:€|EUR|USD|GBP)/i) || texto.match(/(?:€|EUR|USD|GBP)\s*(\d[\d.,]*)/i);
    if (match) return parsearPrecio(match[1]);
  }
  return null;
}

export function esGratisVerificado(actividad: any): boolean {
  if (actividad?.isFree === true || actividad?.free === true || actividad?.is_free === true) return true;
  const textos = CAMPOS_TEXTO_PRECIO.map((campo) => actividad?.[campo]).filter((v) => typeof v === 'string').join(' ');
  return /(?:^|\b)(?:gratis|gratuito|gratuita|free)(?:\b|$)/i.test(textos) && extraerPrecio(actividad) === null;
}
