function removeAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();
}

function shortText(value, max = 80) {
  const clean = removeAccents(value).replace(/\s+/g, ' ');
  return clean.length > max ? clean.slice(0, max - 3) + '...' : clean;
}

function ticketQrMessage(ticket, eventText) {
  // Mensaje corto, sin acentos y muy compatible con qrcode.js.
  // Al escanear el QR aparece la confirmacion principal de la entrada.
  return [
    'ENTRADA CONFIRMADA',
    'Dia y hora: ' + shortText(eventText, 70),
    'Nombre y apellidos: ' + shortText((ticket.nombre || '') + ' ' + (ticket.apellidos || ''), 55),
    'Entrada: ' + shortText(ticket.numero_entrada, 32)
  ].join('\n');
}

function fallbackQrImage(target, text) {
  // Fallback online por si qrcode.js no puede generar el QR en el navegador.
  // Si no hay internet, se mostrara el enlace de texto.
  const encoded = encodeURIComponent(text);
  target.innerHTML = `
    <img alt="QR entrada" style="width:170px;height:170px" src="https://quickchart.io/qr?text=${encoded}&size=170&margin=1" />
    <div class="qrFallbackText" style="display:none">${text.replace(/</g, '&lt;')}</div>
  `;
}

function renderOneQr(elementId, text) {
  const target = document.getElementById(elementId);
  if (!target) return;
  target.innerHTML = '';

  try {
    if (typeof QRCode === 'undefined') {
      fallbackQrImage(target, text);
      return;
    }

    new QRCode(target, {
      text: text,
      width: 170,
      height: 170,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });

    // Si qrcode.js no pinta nada aunque no lance error, usamos fallback.
    setTimeout(() => {
      if (!target.querySelector('canvas') && !target.querySelector('img')) {
        fallbackQrImage(target, text);
      }
    }, 250);
  } catch (error) {
    console.error('Error generando QR local. Se usa fallback:', error);
    fallbackQrImage(target, text);
  }
}

function renderTicketDocuments(mount, tickets, eventText, orderNumber='') {
  mount.innerHTML = tickets.map((t,i)=>`
    <article class="ticketDocument">
      <div class="ticketRibbon">ENTRADA OFICIAL</div>
      <div class="ticketMain">
        <div class="ticketInfo">
          <p class="kicker">Asociación Carnaval</p>
          <h2>Teatro Cardenio</h2>
          <p class="status">Entrada confirmada</p>
          <div class="ticketBlock"><span>Función</span><strong>${eventText}</strong></div>
          <div class="twoCols">
            <div class="ticketBlock"><span>Asistente</span><strong>${t.nombre} ${t.apellidos}</strong></div>
            <div class="ticketBlock"><span>DNI</span><strong>${t.dni}</strong></div>
          </div>
          <div class="threeCols">
            <div class="ticketBlock"><span>Zona</span><strong>${t.seats?.zona || ''}</strong></div>
            <div class="ticketBlock"><span>Fila / Plaza</span><strong>${t.seats?.fila || ''}</strong></div>
            <div class="ticketBlock"><span>Butaca</span><strong>${t.seats?.butaca || ''}</strong></div>
          </div>
          <p class="ticketNumber">${t.numero_entrada}</p>
          <p class="orderNumber">${orderNumber}</p>
        </div>
        <div class="ticketQrArea">
          <div id="ticketQr-${i}" class="ticketQr"></div>
          <p>Escanea para confirmar la entrada</p>
        </div>
      </div>
    </article>`).join('');

  setTimeout(() => {
    tickets.forEach((ticket, index) => {
      renderOneQr('ticketQr-' + index, ticketQrMessage(ticket, eventText));
    });
  }, 250);
}
