const PUBLIC_TICKET_BASE_URL = 'https://alvarodo72-cell.github.io/teatro-cardenio-entradas/ticket.html';
function ticketQrUrl(ticket) { return PUBLIC_TICKET_BASE_URL + '?token=' + encodeURIComponent(ticket.qr_token || ''); }
function renderTicketDocuments(mount, tickets, eventText, orderNumber='') {
  mount.innerHTML = tickets.map((t,i)=>`
    <article class="ticketDocument"><div class="ticketRibbon">ENTRADA OFICIAL</div><div class="ticketMain"><div class="ticketInfo"><p class="kicker">Asociación Carnaval</p><h2>Teatro Cardenio</h2><p class="status">Entrada confirmada</p><div class="ticketBlock"><span>Función</span><strong>${eventText}</strong></div><div class="twoCols"><div class="ticketBlock"><span>Asistente</span><strong>${t.nombre} ${t.apellidos}</strong></div><div class="ticketBlock"><span>DNI</span><strong>${t.dni}</strong></div></div><div class="threeCols"><div class="ticketBlock"><span>Zona</span><strong>${t.seats?.zona || ''}</strong></div><div class="ticketBlock"><span>Fila / Plaza</span><strong>${t.seats?.fila || ''}</strong></div><div class="ticketBlock"><span>Butaca</span><strong>${t.seats?.butaca || ''}</strong></div></div><p class="ticketNumber">${t.numero_entrada}</p><p class="orderNumber">${orderNumber}</p></div><div class="ticketQrArea"><div id="ticketQr-${i}" class="ticketQr"></div><p>Escanea para verificar la entrada</p></div></div></article>`).join('');
  setTimeout(() => tickets.forEach((ticket, index) => {
    const target = document.getElementById('ticketQr-' + index); if (!target) return; target.innerHTML = '';
    new QRCode(target, { text: ticketQrUrl(ticket), width: 170, height: 170, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  }), 150);
}
