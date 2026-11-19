// Contenido de las cuatro recomendaciones nuevas. Los tiempos de traslado son orientativos (redondeados,
// según rutas de referencia y guías); no se incluyen precios, horarios ni disponibilidad.
export const DESTINOS = [
  {
    slug: 'colombia', fichero: 'colombia.html', dias: 14, destinoForm: 'Colombia', pais: 'Colombia',
    titulo: 'Colombia en 14 días: café, montañas, selva y Caribe',
    cardTitulo: 'Colombia, de los Andes cafeteros al Caribe colonial',
    resumen: 'Bogotá, el Eje Cafetero, Medellín, Guatapé, el Parque Tayrona y Cartagena en una ruta que baja de la cordillera al mar.',
    alt: 'Ilustración de montañas verdes y palmeras de Colombia',
    intro: 'Colombia cambia de paisaje cada pocas horas: capitales de altura con museos y cocina de autor, valles de palmas de cera, ciudades que se reinventan y un Caribe de murallas y selva sobre el mar. Esta ruta de 14 días enlaza seis grandes paradas de norte a sur y de altura a costa, con vuelos internos donde la carretera no compensa.',
    chips: ['✈️ 3 vuelos internos', '🏛 Cultura', '🥾 Aventura y naturaleza', '☕ Café y gastronomía'],
    lugares: ['Bogotá', 'Zipaquirá', 'Salento y Valle de Cocora', 'Medellín', 'Guatapé', 'Parque Tayrona', 'Cartagena de Indias', 'Islas del Rosario'],
    dias_plan: [
      ['Bogotá: llegada y La Candelaria', 'Llegada a Bogotá, a unos 2.600 m de altitud: tómatelo con calma. Paseo por el barrio histórico de La Candelaria, Plaza de Bolívar y cena de ajiaco, el guiso de la capital.', 'Aeropuerto → centro: trayecto urbano corto.'],
      ['Bogotá: museos y Monserrate', 'Museo del Oro y Museo Botero por la mañana; por la tarde, subida a Monserrate (teleférico o funicular) para ver la ciudad desde arriba.', 'A pie y en transporte urbano.'],
      ['Zipaquirá y vuelo al Eje Cafetero', 'Excursión a la Catedral de Sal de Zipaquirá, excavada en una mina, y regreso a Bogotá para el vuelo interno a la zona cafetera (Pereira o Armenia).', 'Bogotá–Zipaquirá: aprox. 1 h por carretera. Vuelo interno: aprox. 1 h; después, 1–1,5 h por carretera hasta Salento.'],
      ['Salento y Valle de Cocora', 'Caminata por el Valle de Cocora entre palmas de cera, las más altas del mundo, y tarde en el pueblo de Salento, de casas de colores y balcones.', 'Salento–Valle de Cocora: unos 30 min en jeep o taxi compartido.'],
      ['Finca cafetera', 'Visita a una finca de café: del grano a la taza, con cata. Tarde libre en Salento o de relax en el paisaje cafetero.', 'Traslados cortos desde Salento.'],
      ['Vuelo a Medellín', 'Traslado al aeropuerto y vuelo a Medellín. Tarde de paseo por El Poblado y cena en la zona.', 'Pereira–Medellín: vuelo corto (consulta operadores y horarios) o unas 5–6 h por carretera.'],
      ['Medellín: transformación urbana', 'Recorrido por la Comuna 13 con guía local, murales y escaleras eléctricas; tarde en el Parque Explora o en el centro con las esculturas de Botero.', 'Metro, metrocable y taxi.'],
      ['Guatapé y la Piedra del Peñol', 'Excursión de día a Guatapé: el pueblo de zócalos pintados, el embalse y la subida a la Piedra del Peñol (con sus escalones).', 'Medellín–Guatapé: aprox. 2 h por carretera.'],
      ['Medellín libre y vuelo al Caribe', 'Mañana libre (mercado, café o museo) y vuelo hacia Santa Marta o Barranquilla; consulta conexiones, que a veces tienen escala.', 'Vuelo interno; consulta tiempos al reservar.'],
      ['Parque Tayrona', 'Día de senderos por la selva hasta playas como Cabo San Juan o La Piscina, con baños donde esté permitido. Lleva agua, calzado cómodo y protección solar.', 'Santa Marta–entrada del parque: aprox. 1 h; caminatas dentro del parque.'],
      ['Tayrona y traslado a Cartagena', 'Mañana de playa o senderismo en Tayrona y viaje a Cartagena por la costa.', 'Tayrona–Cartagena: aprox. 4–5 h por carretera.'],
      ['Cartagena: ciudad amurallada', 'Paseo por la ciudad amurallada, la Plaza de los Coches, el castillo de San Felipe de Barajas y Getsemaní, con sus calles de grafiti. Atardecer sobre las murallas.', 'A pie en el casco histórico.'],
      ['Islas del Rosario', 'Excursión en barco a las Islas del Rosario: snorkel, playa y comida de pescado fresco. Alternativa: visita al Palenque de San Basilio, patrimonio afrocolombiano.', 'Cartagena–Islas del Rosario: aprox. 1 h en lancha. Palenque: excursión de día.'],
      ['Despedida de Cartagena', 'Mañana libre para compras en Getsemaní o un último desayuno de frutas tropicales, y vuelo de regreso.', 'Casco histórico–aeropuerto: trayecto urbano corto.']
    ],
    experiencias: [
      ['Cultura', ['Museo del Oro y Museo Botero (Bogotá)', 'Comuna 13 con guía local (Medellín)', 'Ciudad amurallada y Getsemaní (Cartagena)', 'Palenque de San Basilio, patrimonio afrocolombiano']],
      ['Gastronomía', ['Ajiaco bogotano', 'Cata de café en una finca cafetera', 'Bandeja paisa en Medellín', 'Pescado y arroz de coco en la costa']],
      ['Naturaleza y aventura', ['Valle de Cocora y sus palmas de cera', 'Piedra del Peñol y embalse de Guatapé', 'Senderos del Parque Tayrona', 'Snorkel en las Islas del Rosario']]
    ],
    consejos: [
      'Mejor época: la temporada seca (diciembre–marzo y julio–agosto) suele dar mejores condiciones en la mayor parte de la ruta; el clima varía mucho con la altitud.',
      'Bogotá está a unos 2.600 m: descansa el primer día y bebe agua.',
      'Los vuelos internos conectan Bogotá, el Eje Cafetero, Medellín y el Caribe; reserva con antelación y deja margen entre conexiones.',
      'Equipaje en capas: de la frescura andina al calor húmedo del Caribe.',
      'Consulta requisitos de entrada, sanidad y seguros antes de viajar; para Tayrona, comprueba la normativa y el cupo de entrada vigentes.',
      'Los tiempos de traslado son orientativos y dependen del tráfico y la carretera.'
    ],
    enlace: ['https://www.colombia.travel/es', 'Turismo oficial de Colombia'],
    paleta: { cielo: ['#9fd3c7', '#f6e3b4'], sol: '#f3b94c', lejos: '#4f8f78', medio: '#2f6f5e', cerca: '#1d4a3f', motivo: 'palmas' }
  },
  {
    slug: 'corcega', fichero: 'corcega.html', dias: 11, destinoForm: 'Córcega', pais: 'Francia',
    titulo: 'Córcega en 11 días: pueblos, calas y montaña',
    cardTitulo: 'Córcega, la isla de la belleza entre mar y montaña',
    resumen: 'Un circuito de 11 días: Cap Corse, Calvi, Scandola, las calanques de Piana, Bonifacio, Bavella y Corte, sin trayectos de más.',
    alt: 'Ilustración de costa corsa con montañas y un velero',
    intro: 'Córcega es una montaña dentro del mar: acantilados rojos, calas de aguas transparentes, pueblos de piedra colgados de las laderas y una cocina de monte y de costa. Este circuito de 11 días recorre la isla en sentido horario desde Bastia y se queda solo con lo que merece el desvío; hace falta coche, porque el transporte público no llega a la mayoría de los enclaves.',
    chips: ['🚗 Coche de alquiler', '🏖 Calas y playas', '⛰ Montaña y senderismo', '🧀 Gastronomía corsa'],
    lugares: ['Bastia', 'Cap Corse', 'Saint-Florent y desierto de los Agriates', 'Calvi y la Balagne', 'Reserva de Scandola y Porto', 'Calanques de Piana', 'Ajaccio', 'Sartène y Filitosa', 'Bonifacio e islas Lavezzi', 'Porto-Vecchio y Palombaggia', 'Agujas de Bavella', 'Corte y valle de la Restonica'],
    dias_plan: [
      ['Bastia: puerto viejo y citadela', 'Llegada a Bastia, paseo por el puerto viejo, la plaza de Saint-Nicolas y la ciudadela. Primera cena con productos de la isla.', 'Recogida del coche en aeropuerto o puerto.'],
      ['Cap Corse', 'Vuelta al dedo norte de la isla: aldeas marineras como Erbalunga, torres genovesas y viñedos de moscatel. Parada en Nonza, con su playa de guijarros negros.', 'Circuito desde Bastia: aprox. 3,5 h conduciendo sin paradas; reserva el día completo.'],
      ['Saint-Florent y los Agriates', 'Saint-Florent, pueblo de pescadores y yates; excursión en barco o a pie a las playas del desierto de los Agriates, entre las más bellas del norte.', 'Bastia–Saint-Florent: aprox. 1 h. Las playas de los Agriates se alcanzan en barco o a pie por pistas; consulta accesos.'],
      ['Calvi y la Balagne', 'Ciudadela de Calvi sobre el mar y su larga playa. Por la tarde, ruta por los pueblos de la Balagne, el «jardín de Córcega»: Pigna, Sant’Antonino y Lumio.', 'Saint-Florent–Calvi: aprox. 1,5 h.'],
      ['Scandola y Porto', 'Carretera de la costa oeste hasta Porto y excursión en barco a la Reserva Natural de Scandola, Patrimonio Mundial, con acantilados rojos y fauna marina. Tarde en Porto.', 'Calvi–Porto: aprox. 2 h por una carretera de curvas.'],
      ['Calanques de Piana y Ajaccio', 'Mañana en las calanques de Piana, formaciones graníticas rojas sobre el golfo de Porto; después, camino a Ajaccio, ciudad natal de Napoleón.', 'Piana–Ajaccio: aprox. 1,5 h.'],
      ['Ajaccio, Filitosa y Sartène', 'Casa Bonaparte y mercado de Ajaccio. En ruta hacia el sur, el yacimiento megalítico de Filitosa y el pueblo de granito de Sartène.', 'Ajaccio–Filitosa–Sartène: aprox. 1,5–2 h con paradas cortas.'],
      ['Bonifacio y las Lavezzi', 'Ciudad alta sobre acantilados de caliza, puerto y escalera del Rey de Aragón. Excursión en barco a las islas Lavezzi o a las grutas de la costa.', 'Sartène–Bonifacio: aprox. 1 h. Excursiones en barco desde el puerto.'],
      ['Porto-Vecchio y Palombaggia', 'Playas de arena clara y aguas turquesas como Palombaggia y Santa Giulia; tarde en el casco antiguo de Porto-Vecchio.', 'Bonifacio–Porto-Vecchio: aprox. 35–45 min.'],
      ['Bavella y Corte', 'Subida a las agujas de Bavella, con paradas en los miradores y un baño en pozas de río si el tiempo lo permite. Por la tarde, Corte, la capital histórica de la isla y su ciudadela.', 'Porto-Vecchio–Bavella: aprox. 1,5 h; Bavella–Corte: aprox. 2,5–3 h con paradas.'],
      ['Valle de la Restonica y regreso', 'Paseo corto por el valle de la Restonica, con pozas de montaña. Regreso a Bastia para el vuelo o el ferry.', 'Corte–Bastia: aprox. 1,5 h.']
    ],
    experiencias: [
      ['Cultura e historia', ['Ciudadelas de Bastia, Calvi y Bonifacio', 'Casa Bonaparte en Ajaccio', 'Yacimiento megalítico de Filitosa', 'Corte, capital histórica de la isla']],
      ['Gastronomía', ['Charcutería corsa (figatellu, coppa, lonzu)', 'Brocciu, el queso fresco de la isla', 'Vinos de Patrimonio y moscatel de Cap Corse', 'Castañas y miel del maquis']],
      ['Naturaleza y aventura', ['Reserva Natural de Scandola', 'Calanques de Piana', 'Playas de Palombaggia y los Agriates', 'Senderos y pozas en Bavella y la Restonica']]
    ],
    consejos: [
      'Mejor época: de mayo a septiembre para mar y playas; junio y septiembre suelen ser más tranquilos y templados que julio-agosto.',
      'Hace falta coche de alquiler: reserva con antelación en temporada alta.',
      'Las carreteras son estrechas y sinuosas: los tiempos de este itinerario son orientativos y conviene sumar paradas.',
      'Las excursiones en barco a Scandola, los Agriates y las Lavezzi dependen de la meteorología y la temporada: consúltalas con antelación.',
      'Destinos cercanos que hemos dejado fuera a propósito: Cerdeña (a un ferry corto desde Bonifacio) merece un viaje aparte y no cabe en este circuito sin recortar Córcega.',
      'Llegada y salida por Bastia: comprueba vuelos y ferris; si prefieres, cambia a Ajaccio o Calvi como puerta de entrada.'
    ],
    enlace: ['https://www.visit-corsica.com/es', 'Turismo oficial de Córcega'],
    paleta: { cielo: ['#8fc7e6', '#fde8c8'], sol: '#f7c66a', lejos: '#7aa0b4', medio: '#3f6f8a', cerca: '#9a4d3a', motivo: 'velero' }
  },
  {
    slug: 'rajastan', fichero: 'rajastan.html', dias: 14, destinoForm: 'Rajastán', pais: 'India',
    titulo: 'Rajastán en 14 días: palacios, fuertes y ciudades de colores',
    cardTitulo: 'Rajastán, tierra de maharajás, fuertes y bazares',
    resumen: 'Delhi, Agra, Jaipur, Pushkar, Jodhpur y Udaipur en un recorrido de fuertes, palacios, mercados y sabores locales.',
    alt: 'Ilustración de un fuerte de arenisca con cúpulas al atardecer en el desierto',
    intro: 'Rajastán es la India de las postales: fuertes de arenisca sobre colinas, palacios sobre lagos, ciudades rosas, azules y blancas, y bazares que huelen a especias. Esta ruta de 14 días arranca en Delhi, pasa por el Taj Mahal y recorre las ciudades reales de Jaipur, Pushkar, Jodhpur y Udaipur con jornadas de carretera razonables y tiempo para sentarse a mirar.',
    chips: ['🚗 Chófer o tren', '🏰 Fuertes y palacios', '🛍 Mercados', '🍛 Cocina rajastaní'],
    lugares: ['Delhi', 'Agra y Fatehpur Sikri', 'Jaipur', 'Pushkar', 'Jodhpur', 'Ranakpur', 'Udaipur'],
    dias_plan: [
      ['Delhi: llegada', 'Llegada a Delhi y descanso. Si llegas con energía, paseo por el entorno del hotel y primera cena india.', 'Aeropuerto → hotel: trayecto urbano.'],
      ['Delhi antigua y nueva', 'Old Delhi: mezquita Jama Masjid y bazar Chandni Chowk. Por la tarde, Delhi nueva: tumba de Humayun y Puerta de la India.', 'Metro, tuk-tuk o coche con conductor.'],
      ['Agra: el Taj Mahal', 'Traslado a Agra. Visita al Taj Mahal y, según el tiempo, al Fuerte Rojo de Agra. El Taj es especialmente fotogénico a primera hora.', 'Delhi–Agra: aprox. 3–4 h por autopista.'],
      ['Fatehpur Sikri y llegada a Jaipur', 'Parada en Fatehpur Sikri, la ciudad imperial abandonada, y continuación hacia Jaipur, la ciudad rosa.', 'Agra–Fatehpur Sikri: aprox. 1 h; hasta Jaipur: aprox. 4–5 h.'],
      ['Jaipur: fuerte de Amber', 'Fuerte de Amber, con vistas al lago Maota, y por la tarde Jal Mahal y el Hawa Mahal, el palacio de los vientos.', 'Jaipur–Amber: aprox. 30–45 min.'],
      ['Jaipur: ciudad rosa y bazares', 'Palacio de la Ciudad, observatorio Jantar Mantar y paseo por los bazares de joyas, textiles y cerámica azul.', 'En la propia ciudad, en coche o tuk-tuk.'],
      ['Pushkar', 'Camino a Pushkar, ciudad sagrada alrededor de un lago con ghats y mercados. Atardecer junto al lago, con respeto a las normas del recinto (calzado, fotografías).', 'Jaipur–Pushkar: aprox. 3 h.'],
      ['Jodhpur: la ciudad azul', 'Traslado a Jodhpur y visita al fuerte de Mehrangarh, sobre la ciudad de casas azules. Paseo al caer la tarde por el bazar de Sardar.', 'Pushkar–Jodhpur: aprox. 3,5 h.'],
      ['Jodhpur: palacios y vida local', 'Jaswant Thada, palacio de Umaid Bhawan (visita al museo) y el mercado de especias. Cena de dal baati churma u otro plato local.', 'En la ciudad.'],
      ['Ranakpur y Udaipur', 'Parada en los templos jainistas de Ranakpur, de mármol tallado, y continuación a Udaipur, la ciudad de los lagos.', 'Jodhpur–Ranakpur: aprox. 3 h; Ranakpur–Udaipur: aprox. 2 h.'],
      ['Udaipur: lago y palacio', 'Palacio de la Ciudad sobre el lago Pichola y paseo en barca al atardecer, con vistas del Palacio del Lago.', 'En la ciudad.'],
      ['Udaipur: arte y cocina', 'Jardín Saheliyon Ki Bari, museo de arte y miniaturas, taller de cocina o visita a un artesano de pintura en miniatura.', 'A pie o en tuk-tuk.'],
      ['Día de margen en Udaipur', 'Día flexible: excursión a Kumbhalgarh o Chittorgarh si hay ganas de otro fuerte, o descanso y compras. Es el colchón de la ruta.', 'Ambas excursiones suponen jornada completa por carretera.'],
      ['Vuelo de regreso', 'Mañana libre y vuelo de salida desde Udaipur (con conexión por Delhi u otro aeropuerto); si el vuelo sale de Delhi, calcula el traslado.', 'Consulta conexiones al reservar.']
    ],
    experiencias: [
      ['Cultura e historia', ['Taj Mahal y Fuerte Rojo de Agra', 'Fuerte de Amber y Palacio de la Ciudad (Jaipur)', 'Fuerte de Mehrangarh (Jodhpur)', 'Templos jainistas de Ranakpur']],
      ['Gastronomía', ['Dal baati churma', 'Laal maas y otros platos del desierto', 'Lassi y chai en puestos locales', 'Taller de cocina en Udaipur']],
      ['Experiencias locales', ['Bazares de Jaipur y Jodhpur', 'Paseo en barca por el lago Pichola', 'Pintura en miniatura y textiles', 'Atardecer en los ghats de Pushkar']]
    ],
    consejos: [
      'Mejor época: de octubre a marzo, con días templados; de abril a septiembre el calor y el monzón complican la ruta.',
      'Distancias largas: la forma habitual es coche con conductor; algunos tramos pueden hacerse en tren, consulta horarios y reservas con antelación.',
      'Los tiempos de traslado son orientativos: el tráfico en India es impredecible.',
      'Vestimenta: hombros y rodillas cubiertos en templos; calzado fácil de quitar.',
      'Consulta requisitos de visado y sanidad con antelación.',
      'No hemos incluido Jaisalmer ni Bikaner para no sumar jornadas de carretera de más; pueden añadirse si amplías la ruta.'
    ],
    enlace: ['https://www.tourism.rajasthan.gov.in/', 'Turismo oficial de Rajastán'],
    paleta: { cielo: ['#f4a46c', '#fde5b5'], sol: '#f58a4a', lejos: '#c9825a', medio: '#a85a3c', cerca: '#6a3426', motivo: 'fuerte' }
  },
  {
    slug: 'sarajevo', fichero: 'sarajevo.html', dias: 4, destinoForm: 'Sarajevo', pais: 'Bosnia y Herzegovina',
    titulo: 'Sarajevo en 4 días: donde Oriente y Occidente se cruzan',
    cardTitulo: 'Sarajevo, la ciudad donde se cruzan imperios',
    resumen: 'Bazar otomano, arquitectura austrohúngara, historia viva, café bosnio y una excursión a Mostar en cuatro días.',
    alt: 'Ilustración de Sarajevo con un minarete entre colinas y tejados',
    intro: 'Sarajevo se recorre en pocos pasos y en varios siglos: del bazar otomano de Baščaršija a los bulevares austrohúngaros, con minaretes, campanarios y una sinagoga a pocas calles de distancia. Cuatro días permiten descubrir su historia reciente con respeto, comer muy bien y salir un día a Mostar.',
    chips: ['🚶 A pie', '🕌 Herencia otomana', '🏛 Arquitectura austrohúngara', '☕ Café y cocina bosnia'],
    lugares: ['Baščaršija', 'Puente Latino', 'Calle Ferhadija', 'Vijećnica', 'Túnel de la Esperanza', 'Fortaleza Amarilla', 'Trebević', 'Mostar'],
    dias_plan: [
      ['Baščaršija: el bazar otomano', 'Llegada y paseo por Baščaršija, con la fuente Sebilj, talleres de cobre, la mezquita de Gazi Husrev-beg y el caravasar. Café bosnio en una terraza y cena de ćevapi.', 'Aeropuerto → centro: trayecto urbano corto.'],
      ['Imperios y siglo XX', 'Cruce de la calle Ferhadija, frontera simbólica entre el barrio otomano y el austrohúngaro. Vijećnica (ayuntamiento), Puente Latino y museo sobre la ciudad entre 1878 y 1918. Tarde en la catedral y la sinagoga.', 'A pie.'],
      ['Mostar: excursión de día', 'Excursión a Mostar: casco histórico y Stari Most, el puente reconstruido. Vuelta a Sarajevo al caer la tarde.', 'Sarajevo–Mostar: aprox. 2 h por carretera; hay servicios de autobús y excursiones organizadas.'],
      ['Historia reciente, colinas y despedida', 'Visita al Túnel de la Esperanza, testimonio del asedio. Por la tarde, subida a la Fortaleza Amarilla o a Vratnik para ver el atardecer, y última cena de burek o bosanski lonac.', 'Túnel: aprox. 20–30 min del centro. Otras opciones: teleférico de Trebević, cuando esté operativo.']
    ],
    experiencias: [
      ['Cultura e historia', ['Mezquita de Gazi Husrev-beg', 'Vijećnica y museo de 1878–1918', 'Túnel de la Esperanza', 'Catedral y sinagoga a pocas calles de la mezquita']],
      ['Gastronomía', ['Ćevapi con somun', 'Burek y sirnica', 'Café bosnio en jezva (el ritual)', 'Baklava y tufahije']],
      ['Experiencias locales', ['Talleres de cobre en Baščaršija', 'Atardecer en Fortaleza Amarilla', 'Excursión a Mostar', 'Paseo por el río Miljacka']]
    ],
    consejos: [
      'Mejor época: primavera y otoño; en verano puede hacer calor y el invierno es frío, con ambiente especial.',
      'La ciudad se recorre a pie; hay tranvía para los tramos más largos.',
      'El Túnel de la Esperanza y otros lugares ligados al asedio de los años noventa merecen una visita respetuosa; consulta horarios y condiciones antes de ir.',
      'La moneda local es el marco convertible (BAM); consulta el cambio y la aceptación de tarjeta al llegar.',
      'Los tiempos de traslado son orientativos y los horarios de museos varían: confírmalos antes de ir.',
      'Para Mostar, valora ir con excursión organizada o en autobús desde la estación; los trayectos dependen de la temporada.'
    ],
    enlace: ['https://www.sarajevo.travel/es', 'Turismo oficial de Sarajevo'],
    paleta: { cielo: ['#a9bfd6', '#f3e2cc'], sol: '#f0b46a', lejos: '#7b8fa6', medio: '#4d6179', cerca: '#2c3b52', motivo: 'minarete' }
  }
];
