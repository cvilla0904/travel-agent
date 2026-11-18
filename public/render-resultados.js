/*
 * Mogavel — parsers y renderizado de resultados (vuelos, hoteles, actividades).
 *
 * Extraído de index.html SIN cambios de comportamiento ni de formato: el HTML que
 * genera es el mismo. Única diferencia: renderResultados(respuesta, target) acepta
 * un contenedor de destino opcional (por defecto, #results).
 * Es un script clásico: expone escapeHtml, linkifyText y renderResultados como globales.
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[char]));
}

function linkifyText(value) {
  // Primero preservamos los enlaces Markdown que ya devuelve el agente.
  // Así evitamos convertir de nuevo la URL que está dentro de [texto](URL).
  const placeholders = [];
  const withPlaceholders = String(value).replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    function(match, label, url) {
      const index = placeholders.length;
      placeholders.push(
        '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="result-link">' +
        escapeHtml(label) +
        ' ↗</a>'
      );
      return '__MARKDOWN_LINK_' + index + '__';
    }
  );

  const escaped = escapeHtml(withPlaceholders);

  const linked = escaped.replace(
    /https?:\/\/[^\s<]+/g,
    function(url) {
      const cleanUrl = url.replace(/[),.;]+$/, '');
      return '<a href="' + cleanUrl + '" target="_blank" rel="noopener noreferrer" class="result-link">Ver oferta ↗</a>';
    }
  );

  return linked.replace(
    /__MARKDOWN_LINK_(\d+)__/g,
    function(match, index) {
      return placeholders[Number(index)] || match;
    }
  );
}

function renderResultados(respuesta, target) {
  const results = target || document.getElementById('results');
  const chatBox = document.getElementById('chatBox');
  if (chatBox) chatBox.style.display = 'block';
  // El agente no siempre escribe «### Vuelos» tal cual: a veces añade emoji («## ✈️ Vuelos»), numeración,
  // fechas con dígitos («## Vuelos Madrid → París (11–18 ene)») o usa negrita en vez de almohadillas.
  // Se normaliza solo la ETIQUETA de sección (nunca el contenido) para que el parser la reconozca.
  const SECCION = /^(?:Vuelos|Alojamientos?|Hoteles|Actividades|Presupuesto|Experiencias)\b/i;
  const etiquetaDeSeccion = (trimmed) => {
    const conAlmohadillas = trimmed.match(/^(#{1,6})\s*(.+)$/);
    const soloNegrita = trimmed.match(/^\*\*([^*]{2,100})\*\*\s*:?\s*$/);
    if (!conAlmohadillas && !soloNegrita) return null;
    const texto = (conAlmohadillas ? conAlmohadillas[2] : soloNegrita[1])
      .replace(/\*\*/g, '')
      .replace(/^(?:\d+[.)]\s*)?[^\p{L}\p{N}]*/u, '')   // emoji, viñetas y numeración iniciales
      .replace(/^(?:\d+[.)]\s*)/, '')
      .replace(/\s*:\s*$/, '')                          // «**Vuelos:**»
      .trim();
    if (!SECCION.test(texto)) return null;
    return { nivel: conAlmohadillas ? conAlmohadillas[1].length : 0, texto };
  };
  const lines = respuesta.replace(/\r/g, '').split('\n').map(line => {
    const trimmed = line.trim();
    const etiqueta = etiquetaDeSeccion(trimmed);
    if (etiqueta) {
      // Vuelos se reconoce siempre como «###»; el resto conserva su nivel (los subtítulos «####» de hoteles
      // siguen siéndolo) y la negrita pasa a «###».
      if (/^Vuelos\b/i.test(etiqueta.texto)) return '### ' + etiqueta.texto;
      return '#'.repeat(etiqueta.nivel || 3) + ' ' + etiqueta.texto;
    }
    // The agent sometimes emits plain section labels instead of Markdown headings.
    if (/^(?:#{1,6}\s*)?Vuelos(?:\s+[^.:€\d]{0,40})?$/i.test(trimmed)) return '### ' + trimmed.replace(/^#{1,6}\s*/, '');
    if (/^(?:#{1,6}\s*)?Alojamientos(?:\s+en\s+.+|\s+encontrados|\s+reales)?\s*$/i.test(trimmed)) return '### ' + trimmed.replace(/^#{1,6}\s*/, '');
    if (/^(?:#{1,6}\s*)?Actividades(?:\s+.+)?$/i.test(trimmed)) return '### ' + trimmed.replace(/^#{1,6}\s*/, '');
    if (/^(?:#{1,6}\s*)?Presupuesto\s*$/i.test(trimmed)) return '### ' + trimmed.replace(/^#{1,6}\s*/, '');
    return line;
  });
  const headingIndex = lines.findIndex(line => /^###\s+Vuelos(?:\s+.+)?\s*$/i.test(line.trim()));

  function markdownLink(text) {
    const match = String(text).match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    return match ? { label: match[1], url: match[2].replace(/[),.;]+$/, '') } : null;
  }

  function renderTripSummary(linesBefore) {
    const raw = linesBefore.filter(Boolean);
    const routeLine = raw.find(line => /^##\s+/.test(line.trim())) || '';
    const datesLine = raw.find(line => /^\*\*Fechas:\*\*/i.test(line.trim())) || '';
    const travelersLine = raw.find(line => /^\*\*Viajeros:\*\*/i.test(line.trim())) || '';

    const route = routeLine.replace(/^##\s+/, '').replace(/\*\*/g, '').trim();
    const dates = datesLine.replace(/^\*\*Fechas:\*\*\s*/i, '').replace(/\*\*/g, '').trim();
    const travelers = travelersLine.replace(/^\*\*Viajeros:\*\*\s*/i, '').replace(/\*\*/g, '').trim();

    if (!route && !dates && !travelers) return '';

    return '<section class="trip-summary">' +
      '<div class="trip-route"><span class="trip-kicker">Tu viaje</span><strong>' + escapeHtml(route || 'Viaje personalizado') + '</strong></div>' +
      (dates ? '<div class="trip-meta"><span class="trip-meta-icon">◷</span><div><span>Fechas</span><strong>' + escapeHtml(dates) + '</strong></div></div>' : '') +
      (travelers ? '<div class="trip-meta"><span class="trip-meta-icon">♙</span><div><span>Viajeros</span><strong>' + escapeHtml(travelers) + '</strong></div></div>' : '') +
      '</section>';
  }

  function parseHotelBlocks(sectionLines) {
    const normalizeLine = line => String(line)
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\*{1,2}\s*/, '')
      .replace(/\*{1,2}\s*$/, '')
      .trim();

    const markerIndex = sectionLines.findIndex(line => {
      const normalized = normalizeLine(line).replace(/\*{2}/g, '');
      return /^(?:(?:Alojamiento|Alojamientos)(?:\s+(?:en\s+.+|encontrados|reales|recomendados|econ[oó]micos))?|Hoteles(?:\s+(?:en\s+.+|encontrados|reales))?|Otros alojamientos)\s*:??$/i.test(normalized);
    });
    if (markerIndex === -1) return { html: '' };

    const hotelEndIndex = sectionLines.findIndex((line, index) =>
      index > markerIndex && /^(?:#{1,6}\s*)?Actividades(?:\s|$)/i.test(line.trim())
    );
    const hotelLines = sectionLines.slice(
      markerIndex + 1,
      hotelEndIndex === -1 ? sectionLines.length : hotelEndIndex
    );

    const groups = [];
    let group = { title: 'Alojamientos', hotels: [] };
    let current = null;
    const finishHotel = () => {
      if (current) group.hotels.push(current);
      current = null;
    };
    const finishGroup = () => {
      finishHotel();
      if (group.hotels.length) groups.push(group);
    };

    hotelLines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const heading = trimmed.match(/^#{1,6}\s*(Alojamientos recomendados|Alojamientos económicos|Otros alojamientos)\s*$/i);
      if (heading) {
        finishGroup();
        group = { title: heading[1], hotels: [] };
        return;
      }

      const itemMatch = trimmed.match(/^(?:[-•]\s*|\d+[.)]\s*)(.+)$/);
      if (itemMatch) {
        finishHotel();
        current = { text: itemMatch[1].trim(), lines: [itemMatch[1].trim()] };
        return;
      }

      if (current && !/^Indica qué alojamiento/i.test(trimmed) && !/^Selecciona/i.test(trimmed)) {
        current.lines.push(trimmed);
      }
    });
    finishGroup();

    // The model may return a flat list instead of the requested headings.
    // In that case, classify locally from the rating, review count and
    // total price actually present in each hotel line.
    if (groups.length === 1 && groups[0].title === 'Alojamientos') {
      const hotels = groups[0].hotels;
      const metrics = hotels.map(hotel => {
        const text = hotel.lines.join(' ').replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g, '');
        // Booking puntúa sobre 10; se admite /10 y se normaliza a escala 5.
        const ratingMatch = text.match(/(?:valoraci[oó]n\s*)?(\d+(?:[.,]\d{1,2})?)\s*\/\s*(10|5)(?!\d)/i);
        const reviewsMatch = text.match(/([\d.]+)\s*(?:reseñas|opiniones|reviews)/i);
        const priceMatch = text.match(/(?:€\s*)?([\d.]+(?:,\d{1,2})?)\s*€(?:\s*(?:total|\/noche))?/i);
        const rating = ratingMatch ? Number(ratingMatch[1].replace(',', '.')) * (ratingMatch[2] === '10' ? 0.5 : 1) : 0;
        const reviews = reviewsMatch ? Number(reviewsMatch[1].replace(/\./g, '')) : 0;
        const price = priceMatch ? Number(priceMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
        return { hotel, rating, reviews, price };
      });
      const knownPrices = metrics.map(item => item.price).filter(price => price > 0).sort((a, b) => a - b);
      const medianPrice = knownPrices.length
        ? knownPrices[Math.floor((knownPrices.length - 1) / 2)]
        : 0;
      const recommended = [];
      const economic = [];
      const others = [];

      // Clasificación tolerante con respuestas de presupuesto que no incluyen
      // número de reseñas: no descartamos alojamientos por faltar ese dato.
      metrics.forEach(item => {
        const hasGoodRating = item.rating >= 4.2;
        const isRecommended = item.rating >= 4.3 && (item.reviews >= 100 || item.reviews === 0);
        const isEconomic = item.price > 0 && medianPrice > 0 &&
          item.price <= medianPrice && hasGoodRating && !isRecommended;
        if (isRecommended) recommended.push(item.hotel);
        else if (isEconomic) economic.push(item.hotel);
        else others.push(item.hotel);
      });

      groups.length = 0;
      groups.push({ title: 'Alojamientos recomendados', hotels: recommended });
      groups.push({ title: 'Alojamientos económicos', hotels: economic });
      groups.push({ title: 'Otros alojamientos', hotels: others });
    }

    const renderedGroups = groups.map(category => {
      const cards = category.hotels.map(hotel => {
        const allText = hotel.lines.join(' ');
        const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
        const links = [];
        let match;
        while ((match = linkPattern.exec(allText)) !== null) {
          const url = match[2].replace(/[),.;]+$/, '');
          if (/^https?:\/\//i.test(url) && !links.some(item => item.url === url)) {
            links.push({ label: match[1], url });
          }
        }

        const plain = allText
          .replace(linkPattern, '')
          .replace(/\*{1,2}/g, '')
          .replace(/Ver alojamiento\s*↗?/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        const separator = plain.match(/^(.+?)\s*[—–-]\s*(.+)$/);
        const name = (separator ? separator[1] : plain).trim();
        const detail = separator ? separator[2].trim() : '';
        const mainLink = links[0];

        return '<article class="hotel-card">' +
          '<div class="hotel-main"><div class="hotel-name">' + escapeHtml(name) + '</div>' +
          '<div class="hotel-detail">' + escapeHtml(detail) + '</div>' +
          (links.length > 1
            ? '<div class="hotel-offers">' + links.map((item, index) =>
                '<a class="hotel-offer-link result-link" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">' +
                escapeHtml(item.label || ('Oferta ' + (index + 1))) + ' ↗</a>'
              ).join('') + '</div>'
            : '') +
          '</div>' +
          (mainLink
            ? '<a class="hotel-link result-link" href="' + escapeHtml(mainLink.url) + '" target="_blank" rel="noopener noreferrer">Ver oferta ↗</a>'
            : '<span class="hotel-no-link">Enlace no disponible</span>') +
          '</article>';
      }).join('');

      const categoryBody = cards ||
        '<div class="search-note">No hay alojamientos que cumplan los criterios de esta categoría en los resultados actuales.</div>';
      return '<section class="hotel-category"><h4 class="hotel-category-title">' +
        escapeHtml(category.title) + '</h4><div class="hotel-results">' + categoryBody + '</div></section>';
    }).join('');

    return {
      html: renderedGroups
        ? '<section style="margin-top:24px"><h3 class="result-section-title hotels">Alojamientos</h3>' +
          '<div class="hotel-category-grid">' + renderedGroups + '</div></section>'
        : ''
    };
  }

  function parseActivityBlocks(sectionLines) {
    const groups = [];
    let currentGroup = null;
    let currentActivity = null;

    sectionLines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (/^#{0,6}\s*Actividades/i.test(trimmed)) {
        if (currentActivity) currentGroup.activities.push(currentActivity);
        if (currentGroup && currentGroup.activities.length) groups.push(currentGroup);

        const adventure = /aventura/i.test(trimmed);
        currentGroup = {
          title: trimmed.replace(/^#{1,6}\s*/, '').trim(),
          adventure,
          activities: []
        };
        currentActivity = null;
        return;
      }

      const item = trimmed.match(/^(?:-\s*|\d+\.\s*)(.+)$/);
      if (item && currentGroup) {
        if (currentActivity) currentGroup.activities.push(currentActivity);
        currentActivity = { text: item[1].trim(), link: null };
        const link = markdownLink(currentActivity.text);
        if (link) currentActivity.link = link;
        return;
      }

      if (currentActivity && /Ver actividad/i.test(trimmed)) {
        const link = markdownLink(trimmed);
        if (link) currentActivity.link = link;
      }
    });

    if (currentActivity && currentGroup) currentGroup.activities.push(currentActivity);
    if (currentGroup && currentGroup.activities.length) groups.push(currentGroup);

    const sections = groups.map(group => {
      const cards = group.activities.map(activity => {
        const linkedTitle = activity.text.match(/^\[\*\*(.+?)\*\*\]\((https?:\/\/[^)]+)\)/);
        const markdownTitle = activity.text.match(/^\[(.+?)\]\((https?:\/\/[^)]+)\)/);
        const link = activity.link || (linkedTitle ? { url: linkedTitle[2] } : markdownTitle ? { url: markdownTitle[2] } : null);
        // Remove the booking CTA/link before parsing the activity label and metadata.
        const cleanText = activity.text
          .replace(/\[Ver actividad(?:\s*↗)?\]\(https?:\/\/[^)]+\)/gi, '')
          .replace(/Ver actividad\s*↗?/gi, '')
          .replace(/\*\*/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const labelText = linkedTitle ? linkedTitle[1] : markdownTitle ? markdownTitle[1].replace(/\*\*/g, '') : cleanText;
        const parts = labelText.split(/\s+[—–]\s+/, 2);
        const name = (linkedTitle || markdownTitle ? labelText : parts[0]).trim();
        const detail = (linkedTitle || markdownTitle
          ? cleanText.replace(labelText, '').replace(/^\s*[—–-]\s*/, '')
          : (parts[1] || '')).trim();

        // No inferimos gratuidad de un importe cero: puede ser un dato por defecto del agente.
        const freeSignal = /(?:^|[;,.\s])(?:gratuita|gratuito|gratis|free)(?:$|[;,.\s])/i.test(detail);
        const priceMatch = detail.match(/(?:desde\s*)?(\d[\d.,]*)\s*(?:€|EUR)(?![A-Za-z])/i) || detail.match(/(?:€|EUR)\s*(\d[\d.,]*)/i);
        const amount = priceMatch ? Number(priceMatch[1].replace(/\./g, '').replace(',', '.')) : null;
        const explicitlyFree = freeSignal && (amount === null || amount === 0);
        const verifiedPaid = priceMatch && Number.isFinite(amount) && amount > 0;
        const priceBadge = explicitlyFree
          ? '<div class="activity-price-badge free" aria-label="Actividad anunciada como gratuita">GRATUITA</div>'
          : verifiedPaid
            ? '<div class="activity-price-badge from" aria-label="Precio anunciado">DESDE ' + escapeHtml(priceMatch[1]) + ' €</div>'
            : '<div class="activity-price-badge unknown" aria-label="Precio pendiente de verificar">PRECIO POR CONFIRMAR</div>';
        return '<article class="activity-card' + (group.adventure ? ' adventure' : '') + (explicitlyFree ? ' is-free' : '') + (verifiedPaid ? ' is-paid' : '') + '">' +
          '<div class="activity-main"><div class="activity-name">' + escapeHtml(name) + '</div><div class="activity-detail">' + escapeHtml(detail) + '</div></div>' +
          priceBadge +
          (link ? '<a class="activity-link result-link" href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">Ver actividad ↗</a>' : '') +
        '</article>';
      }).join('');

      const headingClass = group.adventure ? 'adventure' : 'activities';
      return '<section style="margin-top:24px"><h3 class="result-section-title ' + headingClass + '">' + escapeHtml(group.title) + '</h3><div class="activity-results">' + cards + '</div></section>';
    }).join('');

    return { html: sections };
  }

  function renderHotels(sectionLines) {
    const titleIndex = sectionLines.findIndex(line => /^###\s+Alojamientos(?: encontrados| reales)?\s*$/i.test(line.trim()));
    if (titleIndex === -1) return { html: '' };

    const hotelLines = sectionLines.slice(titleIndex + 1);
    const hotels = [];
    let current = [];

    hotelLines.forEach(line => {
      const trimmed = line.trim();
      if (/^-\s+\*\*.+?\*\*/.test(trimmed)) {
        if (current.length) hotels.push(current);
        current = [trimmed];
      } else if (current.length && trimmed) {
        current.push(trimmed);
      }
    });
    if (current.length) hotels.push(current);

    const cards = hotels.map(block => {
      const first = block[0];
      const match = first.match(/^-\s+\*\*(.+?)\*\*\s*[—-]\s*(.*)$/);
      if (!match) return '';

      const name = match[1].trim();
      const blockText = [match[2].trim(), ...block.slice(1)].filter(Boolean).join(' ');
      const link = markdownLink(blockText);
      const detail = blockText
        .replace(link ? /\[[^\]]+\]\(https?:\/\/[^)]+\)/ : /$^/, '')
        .trim()
        .replace(/\*\*/g, '');

      return '<article class="hotel-card">' +
        '<div class="hotel-main"><div class="hotel-name">' + escapeHtml(name) + '</div><div class="hotel-detail">' + escapeHtml(detail) + '</div></div>' +
        (link
          ? '<a class="hotel-link result-link" href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">Ver alojamiento ↗</a>'
          : '<span class="hotel-no-link">Enlace no disponible</span>') +
        '</article>';
    }).filter(Boolean).join('');

    if (!cards) return { html: '' };

    const noteLines = hotelLines.filter(line => {
      const trimmed = line.trim();
      return trimmed && !/^-\s+\*\*/.test(trimmed) && !/^\[?\*\*?Ver alojamiento/i.test(trimmed);
    });

    const note = noteLines.join('\n').trim();

    return {
      html: '<section style="margin-top:24px">' +
        '<h3 class="result-section-title hotels">Alojamientos</h3>' +
        '<div class="hotel-results">' + cards + '</div>' +
        (note ? '<div class="search-note">' + linkifyText(note) + '</div>' : '') +
        '</section>'
    };
  }

  function parseMultidestinationSections(sectionLines) {
    const cityStarts = [];
    sectionLines.forEach((line, index) => {
      if (/^###\s+.+\s+[—–-]\s+\d+\s+días\s*$/i.test(line.trim())) {
        cityStarts.push(index);
      }
    });

    if (cityStarts.length < 2) return { html: '' };

    const sections = cityStarts.map((start, index) => {
      const end = cityStarts[index + 1] ?? sectionLines.length;
      const block = sectionLines.slice(start, end);
      const title = block[0].trim().replace(/^###\s+/, '');
      const hotelSection = parseHotelBlocks(block);
      const activitySection = parseActivityBlocks(block);

      return '<section class="multicity-section" style="margin-top:28px">' +
        '<h3 class="multicity-title">' + escapeHtml(title) + '</h3>' +
        (hotelSection.html || '<div class="search-note">No se encontraron alojamientos para esta ciudad.</div>') +
        (activitySection.html || '<div class="search-note">No se encontraron actividades para esta ciudad.</div>') +
        '</section>';
    }).join('');

    return { html: sections };
  }

  if (headingIndex === -1) {
    const hotelMarker = lines.findIndex(line => /^(?:#{1,6}\s*)?Alojamientos(?: encontrados| reales)?\s*$/i.test(line.trim()));
    const multicitySection = parseMultidestinationSections(lines);
    const hasStructuredResults = hotelMarker !== -1 || multicitySection.html;

    if (hotelMarker !== -1) {
      const parsedHotels = parseHotelBlocks(lines.slice(hotelMarker));
      const activityMarker = lines.findIndex((line, index) => index > hotelMarker && /^#{0,6}\s*Actividades/i.test(line.trim()));
      const activityHtml = activityMarker !== -1 ? parseActivityBlocks(lines.slice(activityMarker)).html : '';

      results.innerHTML =
        renderTripSummary(lines.slice(0, hotelMarker)) +
        (parsedHotels.html || '') +
        activityHtml;
      return;
    }

    // Las respuestas posteriores, como el presupuesto, no deben borrar
    // las tarjetas de hoteles y actividades ya mostradas.
    if (multicitySection.html) {
      results.innerHTML =
        renderTripSummary(lines) +
        multicitySection.html;
      return;
    }

    if (!hasStructuredResults && results.innerHTML && !/Preparando una respuesta/i.test(results.textContent || '')) {
      results.innerHTML +=
        '<section style="margin-top:24px">' +
          '<h3 class="result-section-title">Presupuesto</h3>' +
          '<div class="result-text">' + linkifyText(respuesta).replace(/[#*]{1,3}/g, '') + '</div>' +
        '</section>';
      return;
    }

    results.innerHTML = '<div class="result-text">' + linkifyText(respuesta).replace(/[#*]{1,3}/g, '') + '</div>';
    return;
  }
  const beforeLines = lines.slice(0, headingIndex);
  const afterStart = lines.findIndex((line, index) => index > headingIndex && /^#{1,6}\s+(?:Alojamientos|Hoteles|Actividades|Presupuesto|Experiencias)\b/i.test(line.trim()));
  const flightEnd = afterStart === -1 ? lines.length : afterStart;
  const flightLines = lines.slice(headingIndex + 1, flightEnd);

  const flightBlocks = [];
  let currentBlock = [];

  flightLines.forEach(line => {
    // «**Iberia** — 240 € …» se lee igual que «**Iberia**: 240 € …» (solo cambia el separador).
    const trimmed = line.trim().replace(/^((?:-\s+|\d+[.)]\s+)?\*\*[^*]+\*\*)\s+[—–]\s+/, '$1: ');
    const flightLabel = trimmed.match(/^(?:-\s+|\d+[.)]\s+)?(?:\*\*)?([^:]+?)(?:\*\*)?:/);
    const isLinkLabel = flightLabel && /^(?:enlace|enlaces|link|url|reserva|reservar|ver|booking|fuente|más información|mas informacion)\b/i.test(flightLabel[1].replace(/\*\*/g, '').trim());
    const hasFlightPrice = /\d[\d.,]*\s*(?:€|EUR(?![A-Za-z]))|(?:€|EUR)\s*\d/i.test(trimmed);
    if (flightLabel && !isLinkLabel && hasFlightPrice) {
      if (currentBlock.length) flightBlocks.push(currentBlock);
      currentBlock = [trimmed];
      return;
    }
    if (currentBlock.length && trimmed) currentBlock.push(trimmed);
  });
  if (currentBlock.length) flightBlocks.push(currentBlock);

  const flights = flightBlocks.map(block => {
    const firstLine = block[0];
    const match = firstLine.match(/^(?:-\s+|\d+[.)]\s+)?\*\*(.+?)\*\*:\s*(.*)$/) ||
      firstLine.match(/^(?:-\s+|\d+[.)]\s+)?([^:|]+):\s*(.*)$/);
    if (!match) return null;

    const airline = match[1].replace(/\*\*/g, '').trim();
    const blockText = [match[2].trim(), ...block.slice(1)].filter(Boolean).join(' ');
    const markdownUrlMatch = blockText.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    const rawUrlMatch = blockText.match(/https?:\/\/[^\s)]+/);
    const url = markdownUrlMatch
      ? markdownUrlMatch[2].replace(/[),.;]+$/, '')
      : rawUrlMatch
        ? rawUrlMatch[0].replace(/[),.;]+$/, '')
        : '';

    const cleanDetails = blockText
      .replace(markdownUrlMatch ? markdownUrlMatch[0] : '', '')
      .replace(rawUrlMatch && !markdownUrlMatch ? rawUrlMatch[0] : '', '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/\*\*/g, '');

    const priceMatch = cleanDetails.match(/([0-9][0-9.,]*)\s*(?:€|EUR(?![A-Za-z]))/i) ||
      cleanDetails.match(/(?:€|EUR)\s*([0-9][0-9.,]*)/i);

    return {
      airline,
      details: cleanDetails,
      price: priceMatch ? priceMatch[1].replace(/[.,]+$/, '') + ' €' : 'Precio no disponible',
      url
    };
  }).filter(Boolean);

  if (flights.length === 0) {
    const sectionsLines = lines.slice(headingIndex + 1);
    const multicitySection = parseMultidestinationSections(sectionsLines);
    const hotelSection = multicitySection.html
      ? { html: '' }
      : parseHotelBlocks(sectionsLines);
    const activityMarker = sectionsLines.findIndex(line => /^#{0,6}\s*Actividades/i.test(line.trim()));
    const activitySection = multicitySection.html
      ? { html: '' }
      : activityMarker !== -1
        ? parseActivityBlocks(sectionsLines.slice(activityMarker))
        : { html: '' };

    // Solo se afirma "sin vuelos" si la respuesta lo dice; un fallo de consulta no es lo mismo.
    const flightsText = lines.slice(headingIndex, flightEnd).join(' ');
    const flightsFailed = /(?:no se pudo|no he podido|no pude|error|fall[óo]|falla|no se ha podido)/i.test(flightsText);
    const flightsSaidNone = /(?:sin vuelos|no (?:hay|he encontrado|se han encontrado|encontr[eé]) vuelos|sin resultados)/i.test(flightsText);
    const emptyFlightNote = flightsFailed
      ? '<div class="empty-flight"><span class="empty-flight-icon">✈️</span><div><strong>No se han podido consultar los vuelos</strong><span>La búsqueda de vuelos ha fallado; no significa que no existan. Inténtalo de nuevo.</span></div></div>'
      : flightsSaidNone
        ? '<div class="empty-flight"><span class="empty-flight-icon">✈️</span><div><strong>Sin vuelos disponibles</strong><span>No se han encontrado vuelos válidos para estas fechas.</span></div></div>'
        : '<div class="empty-flight"><span class="empty-flight-icon">✈️</span><div><strong>No se han podido mostrar los vuelos</strong><span>La respuesta no incluye opciones de vuelo reconocibles. Inténtalo de nuevo.</span></div></div>';

    results.innerHTML =
      renderTripSummary(beforeLines) +
      '<section>' +
        '<h3 class="result-section-title flights">Vuelos</h3>' +
        emptyFlightNote +
      '</section>' +
      (multicitySection.html || hotelSection.html + activitySection.html);
    return;
  }

  const afterLines = lines.slice(flightEnd);
  const multicitySection = parseMultidestinationSections(afterLines);
  const hotelSection = multicitySection.html
    ? { html: '' }
    : parseHotelBlocks(lines.slice(headingIndex + 1));
  const activityMarker = lines.findIndex((line, index) => index > headingIndex && /^#{0,6}\s*Actividades/i.test(line.trim()));
  const activitySection = multicitySection.html
    ? { html: '' }
    : activityMarker !== -1
      ? parseActivityBlocks(lines.slice(activityMarker))
      : { html: '' };

  const cards = flights.map(flight => {
    const parts = flight.details.split(/\s*\|\s*/).filter(Boolean);
    const outbound = parts.find(part => /^Ida:/i.test(part)) || '';
    const inbound = parts.find(part => /^Vuelta:/i.test(part)) || '';
    const extra = parts.filter(part => !/^Ida:|^Vuelta:/i.test(part));
    const legMarkup = (label, value) => {
      if (!value) return '';
      const content = value.replace(/^Ida:\s*|^Vuelta:\s*/i, '');
      const route = content.match(/^(.+?)\s*→\s*(.+?)(?=\s*\|\s*|$)/);
      const tail = route ? content.slice(route[0].length).replace(/^\s*\|\s*/, '') : '';
      return '<div class="flight-leg"><span class="flight-leg-label">' + label + '</span>' +
        '<div class="flight-leg-route">' + (route
          ? '<span>' + escapeHtml(route[1].trim()) + '</span><span class="flight-route-arrow">→</span><span>' + escapeHtml(route[2].trim()) + '</span>'
          : escapeHtml(content)) + '</div>' +
        (tail ? '<div class="flight-leg-meta">' + escapeHtml(tail) + '</div>' : '') +
      '</div>';
    };
    const airlineNames = flight.airline.split(/\s*\+\s*/).map(name => '<span class="flight-carrier">' + escapeHtml(name) + '</span>').join('');
    return '<article class="flight-card">' +
      '<div class="flight-main">' +
        '<div class="flight-airline">' + airlineNames + '</div>' +
        '<div class="flight-itinerary">' + legMarkup('IDA', outbound) + legMarkup('VUELTA', inbound) + '</div>' +
        (extra.length ? '<div class="flight-extra">' + escapeHtml(extra.join(' · ')) + '</div>' : '') +
      '</div>' +
      '<div class="flight-price">' + escapeHtml(flight.price) + '<small>Precio total</small></div>' +
      (flight.url
        ? '<a class="flight-select result-link" href="' + escapeHtml(flight.url) + '" target="_blank" rel="noopener noreferrer">' + (/google\.com\/travel\/flights/i.test(flight.url) ? 'Ver búsqueda en Google Flights ↗' : 'Ver oferta de vuelo ↗') + '</a>'
        : '<span class="flight-no-link">Enlace no disponible</span>') +
    '</article>';
  }).join('');

  results.innerHTML =
    renderTripSummary(beforeLines) +
    '<section>' +
      '<h3 class="result-section-title">Vuelos</h3>' +
      '<div class="flight-results">' + cards + '</div>' +
    '</section>' +
    (multicitySection.html || hotelSection.html + activitySection.html);
}
