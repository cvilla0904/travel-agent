/**
 * Destino elegido en el autocompletado (catálogo geográfico) y su transmisión al agente.
 * El navegador envía, además del texto visible, la identidad geográfica elegida (nombre, país, región, id). Este módulo
 * la valida y la sanea (llega de un cliente no fiable y acaba en el prompt del agente) y la convierte en una etiqueta
 * inequívoca «Ciudad, Región, País» y en un bloque de contexto. Sin dependencias de proveedores.
 */
import { regionEditorial } from '../geo/regiones-editoriales.js';
import { destinoEditorial } from '../geo/destinos-editoriales.js';

export interface DestinoSeleccionado {
  nombre: string;
  pais?: string;
  codigoPais?: string;
  region?: string;
  id?: string;
  tipo?: 'ciudad' | 'region' | 'pais' | 'aeropuerto';
}

const MAX_TEXTO = 80;
const ID_VALIDO = /^(?:gn:\d{1,10}|iata:[A-Za-z]{3}|region:[a-z0-9-]{1,40}|ed:[a-z0-9-]{1,40})$/;
const TIPOS = new Set(['ciudad', 'region', 'pais', 'aeropuerto']);

/** Solo letras, números, espacios y signos de nombre propio; sin saltos de línea, corchetes ni comillas (anti-inyección). */
function limpiar(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  return valor.normalize('NFC').replace(/[^\p{L}\p{N}\s.,'’()\-–/]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
}

/** Devuelve el destino saneado, o null si no hay un destino utilizable (se usa entonces el texto escrito, como siempre). */
export function normalizarDestinoSeleccionado(bruto: unknown): DestinoSeleccionado | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const b = bruto as Record<string, unknown>;
  const nombre = limpiar(b.nombre);
  if (!nombre) return null;
  let id = typeof b.id === 'string' && ID_VALIDO.test(b.id) ? b.id : undefined;
  // Identificador editorial («ed:…») inexistente: se descarta, no se acepta un identificador inventado.
  if (id?.startsWith('ed:') && !destinoEditorial(id)) id = undefined;
  // Identificador con identidad editorial (ed:… o gn:… de un homónimo curado como Salento o Cartagena): el identificador MANDA.
  // Su ciudad, país, código de país, región y tipo se imponen y lo que diga el cliente se ignora, de modo que no se puede
  // combinar, por ejemplo, el id del municipio de Campania con el país Colombia.
  const editorial = id ? regionEditorial(id) : undefined;
  if (id && editorial) return { nombre: editorial.ciudad, pais: editorial.paisNombre, codigoPais: editorial.pais, region: editorial.nombre, id, tipo: 'ciudad' };
  const codigoPais = typeof b.codigoPais === 'string' && /^[A-Za-z]{2}$/.test(b.codigoPais) ? b.codigoPais.toUpperCase() : undefined;
  const pais = limpiar(b.pais);
  // Destino normal del catálogo (sin identidad editorial): se conserva lo saneado, como siempre.
  const region = limpiar(b.region);
  const tipo = typeof b.tipo === 'string' && TIPOS.has(b.tipo) ? (b.tipo as DestinoSeleccionado['tipo']) : undefined;
  return {
    nombre,
    ...(pais ? { pais } : {}),
    ...(codigoPais ? { codigoPais } : {}),
    ...(region ? { region } : {}),
    ...(id ? { id } : {}),
    ...(tipo ? { tipo } : {}),
  };
}

/** «Salento, Quindío, Colombia». Sin duplicar la región ni el país si el nombre ya los lleva. */
export function etiquetaDestino(d: DestinoSeleccionado): string {
  const partes = [d.nombre];
  const yaEsta = (p?: string) => !p || d.nombre.toLowerCase().includes(p.toLowerCase());
  if (!yaEsta(d.region)) partes.push(d.region!);
  if (!yaEsta(d.pais)) partes.push(d.pais!);
  return partes.join(', ');
}

/** Bloque que precede al mensaje del usuario: fija el destino exacto para las herramientas. */
export function contextoDestinoSeleccionado(d: DestinoSeleccionado): string {
  const datos = [
    d.codigoPais ? `país ${d.codigoPais}` : '',
    d.region ? `región ${d.region}` : '',
    d.id ? `id geográfico ${d.id}` : '',
  ].filter(Boolean).join(', ');
  return `[Destino elegido por el usuario en el catálogo geográfico: ${etiquetaDestino(d)}${datos ? ` (${datos})` : ''}. ` +
    `Usa exactamente «${etiquetaDestino(d)}» como destino en las herramientas y no lo sustituyas por otro lugar con el mismo nombre.]`;
}

/** Mensaje final para el agente: el del usuario, precedido del contexto del destino elegido si lo hay y es válido. */
export function mensajeConDestinoSeleccionado(mensaje: string, bruto: unknown): string {
  const d = normalizarDestinoSeleccionado(bruto);
  return d ? `${contextoDestinoSeleccionado(d)}\n\n${mensaje}` : mensaje;
}
