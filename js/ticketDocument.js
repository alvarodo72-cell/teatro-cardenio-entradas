const PUBLIC_TICKET_BASE_URL = 'https://alvarodo72-cell.github.io/teatro-cardenio-entradas/ticket.html';
const TICKET_GESTION_FEE = 2.5;

function ticketQrUrl(ticket) {
  return PUBLIC_TICKET_BASE_URL + '?token=' + encodeURIComponent(ticket.qr_token || '');
}

function renderTicketDocuments(mount, tickets, eventText, orderNumber = '', isInvitation = false) {
  mount.innerHTML = tickets.map((t, i) => {
    const seatPrice = isInvitation ? 0 : Number(t.seats?.precio || t.seats?.precio_base || 0);
    const gestionFee = isInvitation ? 0 : TICKET_GESTION_FEE;
    const isFree = isInvitation;
    const gestionLine = isFree
      ? '<div class="ticketPriceLine gestion"><span>Gestión</span><strong>0,00 €</strong></div>'
      : `<div class="ticketPriceLine gestion"><span>Gestión (${gestionFee.toFixed(2)} €)</span><strong>${gestionFee.toFixed(2)} €</strong></div>`;
    const totalLine = isFree
      ? '<div class="ticketPriceLine total"><span>Total</span><strong>Invitación</strong></div>'
      : `<div class="ticketPriceLine total"><span>Total</span><strong>${(seatPrice + gestionFee).toFixed(2)} €</strong></div>`;

    return `
    <article class="ticketDocument">
      <div class="ticketRibbon">ENTRADA OFICIAL</div>
      <div class="ticketMain">
        <div class="ticketInfo">
          <img src="logo%20(2).jpeg" alt="Cardenio ACA" class="ticketLogo">
          <p class="kicker">Asociación Carnaval</p>
          <h2>Teatro Cardenio</h2>
          <p class="status">${isFree ? 'Invitación' : 'Entrada confirmada'}</p>
          <div class="ticketBlock">
            <span>Función</span>
            <strong>${eventText}</strong>
          </div>
          <div class="twoCols">
            <div class="ticketBlock">
              <span>Asistente</span>
              <strong>${t.nombre} ${t.apellidos}</strong>
            </div>
            <div class="ticketBlock">
              <span>DNI</span>
              <strong>${t.dni}</strong>
            </div>
          </div>
          <div class="threeCols">
            <div class="ticketBlock">
              <span>Zona</span>
              <strong>${t.seats?.zona || ''}</strong>
            </div>
            <div class="ticketBlock">
              <span>Fila / Plaza</span>
              <strong>${t.seats?.fila || ''}</strong>
            </div>
            <div class="ticketBlock">
              <span>Butaca</span>
              <strong>${t.seats?.butaca || ''}</strong>
            </div>
          </div>
          ${isFree ? '' : `
          <div class="ticketPriceBlock">
            <div class="ticketPriceLine"><span>Entrada</span><strong>${seatPrice.toFixed(2)} €</strong></div>
            ${gestionLine}
            ${totalLine}
          </div>`}
          <p class="ticketNumber">${t.numero_entrada}</p>
          <p class="orderNumber">${orderNumber}</p>
          <div class="ticketToken">
            <span>Código de validación</span>
            <strong class="tokenCode">${t.short_code || (t.qr_token || '').replace(/-/g, '').substring(0, 8).toUpperCase()}</strong>
          </div>
        </div>
        <div class="ticketQrArea">
          <div id="ticketQr-${i}" class="ticketQr"></div>
          <p>Escanea para verificar</p>
        </div>
      </div>
    </article>`;
  }).join('');

  setTimeout(() => {
    tickets.forEach((ticket, index) => {
      const target = document.getElementById('ticketQr-' + index);
      if (!target) return;
      target.innerHTML = '';
      try {
        new QRCode(target, {
          text: ticketQrUrl(ticket),
          width: 160,
          height: 160,
          colorDark: '#1a2332',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.H
        });
      } catch (e) {
        target.innerHTML = '<div class="qrError">No se pudo generar el QR.<br>Intente imprimir como PDF.</div>';
      }
    });
  }, 200);
}

async function downloadTicketPdf() {
  const docs = document.querySelectorAll('.ticketDocument');
  if (!docs.length) return alert('No hay entrada para descargar.');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  for (let i = 0; i < docs.length; i++) {
    const el = docs[i];
    el.style.margin = '0';
    el.style.boxShadow = 'none';
    el.style.border = '2px solid #7b1d1d';
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    el.style.margin = '';
    el.style.boxShadow = '';
    el.style.border = '';
    const imgData = canvas.toDataURL('image/png');
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgW = pdfW - 20;
    const imgH = (canvas.height * imgW) / canvas.width;
    const finalH = Math.min(imgH, pdfH - 20);
    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'PNG', 10, 10, imgW, finalH);
  }
  pdf.save('entrada_' + Date.now() + '.pdf');
}
