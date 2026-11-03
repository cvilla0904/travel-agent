/** Filtro geográfico de actividades (movido de src/index.ts sin cambios, salvo Praga/Prague). */

function slugCiudadActividades(ciudad: string): string {
  const normalizada = ciudad
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (normalizada === 'cartagena' || normalizada === 'cartagena de indias') {
    return 'cartagena-de-indias';
  }

  return normalizada
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function actividadEsDeCiudad(actividad: any, ciudad: string): boolean {
  const normalizar = (valor: unknown) => String(valor ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const ciudadNormalizada = normalizar(ciudad);
  const ciudadActividad = normalizar(actividad?.city);
  const url = typeof actividad?.url === 'string' ? actividad.url.toLowerCase() : '';
  const titulo = normalizar(actividad?.title);
  const slug = slugCiudadActividades(ciudad);

  // El agente puede traducir el destino al inglés antes de llamar al proveedor.
  // Comparamos equivalencias habituales para no descartar Florencia/Florence.
  const equivalencias: Record<string, string[]> = {
    florencia: ['florencia', 'florence'],
    florence: ['florence', 'florencia'],
    venecia: ['venecia', 'venice'],
    venice: ['venice', 'venecia'],
    roma: ['roma', 'rome'],
    rome: ['rome', 'roma'],
    praga: ['praga', 'prague', 'praha'],
    prague: ['prague', 'praga', 'praha'],
    munich: ['munich'],
    bogota: ['bogota', 'bogota d.c.'],
    medellin: ['medellin'],
    'cartagena de indias': ['cartagena', 'cartagena de indias'],
    cartagena: ['cartagena', 'cartagena de indias'],
  };
  const nombresValidos = equivalencias[ciudadNormalizada] ?? [ciudadNormalizada];

  if (ciudadActividad) {
    // La ciudad estructurada es la señal geográfica más fiable.
    const ciudadLimpia = ciudadActividad
      .replace(/^(atracciones|attractions|things to do)\s+/, '')
      .replace(/\s+(attractions|things to do)$/, '')
      .trim();
    return nombresValidos.some((nombre) =>
      ciudadLimpia === nombre ||
      ciudadLimpia.startsWith(nombre + ',') ||
      ciudadLimpia.startsWith(nombre + ' -') ||
      ciudadLimpia.startsWith(nombre + ' (')
    );
  }

  // Sin ciudad estructurada, no aceptamos una actividad solo porque la URL
  // esté bajo una categoría de ciudad: excursiones a otros destinos suelen
  // publicarse dentro de páginas de Roma. Exigimos mención explícita en título.
  return nombresValidos.some((nombre) =>
    titulo.includes(nombre)
  );
}
