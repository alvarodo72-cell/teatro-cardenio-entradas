const $ = id => document.getElementById(id),
      sb = window.sb,
      { zones, palcoGroups } = window.CARDENIO;

const GESTION_FEE = 2.5;

let currentView = 'patio',
    selected = new Map(),
    seats = [],
    seatByCoord = new Map(),
    statuses = new Map();

/* ---------- Helpers ---------- */
function validDni(d) {
  return /^[0-9]{8}[A-Za-z]$/.test((d || '').trim());
}

function err(el, m) {
  el.querySelector('.errorBox')?.remove();
  const d = document.createElement('div');
  d.className = 'errorBox';
  d.textContent = m;
  el.prepend(d);
}

function toast(msg, type = 'info') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function eventInfo() {
  const e = $('eventId');
  return e.value ? { id: e.value, text: e.options[e.selectedIndex].text } : null;
}

/* ---------- Init ---------- */
async function init() {
  await loadSeats();
  await loadEvents();
  bind();
  setView('patio');
}

/* ---------- Data Loading ---------- */
async function loadSeats() {
  const { data, error } = await sb.from('seats').select('*');
  if (error) return toast('Error al cargar butacas', 'error');
  seats = data || [];
  seatByCoord = new Map(seats.map(s => [s.coord, s]));
}

async function loadEvents() {
  const { data, error } = await sb.from('events')
    .select('*')
    .eq('estado', 'activo')
    .order('fecha')
    .order('hora');
  if (error) return toast('Error al cargar funciones', 'error');

  $('eventId').innerHTML = (data || []).map(e =>
    `<option value="${e.id}">${e.nombre} · ${e.fecha} · ${String(e.hora).slice(0, 5)}</option>`
  ).join('');

  const urlParams = new URLSearchParams(window.location.search);
  const preselected = urlParams.get('event');
  if (preselected && (data || []).some(e => e.id === preselected)) {
    $('eventId').value = preselected;
  }

  const has = (data || []).length;
  $('noEvents').classList.toggle('hidden', has);
  document.querySelector('.zoneChooser').classList.toggle('hidden', !has);
  document.querySelector('.helpBar').classList.toggle('hidden', !has);
  $('mapArea').classList.toggle('hidden', !has);

  if (has) await loadStatuses();
}

async function loadStatuses() {
  statuses.clear();
  const f = eventInfo();
  if (!f) { render(); return; }

  const { data } = await sb.from('event_seats')
    .select('estado, seats(coord)')
    .eq('event_id', f.id);

  (data || []).forEach(r => {
    if (r.seats?.coord) statuses.set(r.seats.coord, r.estado);
  });
  render();
}

/* ---------- Bindings ---------- */
function bind() {
  document.querySelectorAll('.zoneCard').forEach(b => {
    b.onclick = () => setView(b.dataset.view);
  });

  $('eventId').onchange = async () => {
    selected.clear();
    await loadStatuses();
  };

  $('clear').onclick = () => { selected.clear(); render(); };
  function openOverlay(el) { el.classList.remove('hidden'); document.body.classList.add('modalOpen'); }
  function closeOverlay(el) { el.classList.add('hidden'); document.body.classList.remove('modalOpen'); }
  $('adminLoginBtn').onclick = () => openOverlay($('loginOverlay'));
  $('closeLogin').onclick = () => closeOverlay($('loginOverlay'));
  $('doLogin').onclick = login;
  $('adminPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('adminEmail').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('checkout').onclick = openCheckout;
  $('closeCheckout').onclick = () => closeOverlay($('checkoutOverlay'));
  $('backBuyer').onclick = () => step('buyer');
  $('backAttendees').onclick = () => step('att');
  $('closeTickets').onclick = () => closeOverlay($('ticketOverlay'));
  $('printTickets').onclick = () => {
    const overlay = $('ticketOverlay');
    if (overlay) openOverlay(overlay);
    setTimeout(() => window.print(), 100);
  };
  $('downloadPdf').onclick = downloadTicketPdf;
  $('goAttendees').onclick = goAttendees;
  $('goPayment').onclick = goPayment;
  $('finishOrder').onclick = createOrder;
}

async function login() {
  const { data, error } = await sb.auth.signInWithPassword({
    email: $('adminEmail').value.trim(),
    password: $('adminPassword').value
  });
  if (error) return toast('Credenciales incorrectas', 'error');

  const { data: p } = await sb.from('profiles')
    .select('rol')
    .eq('id', data.user.id)
    .single();

  if (!p || !['superadmin', 'taquilla'].includes(p.rol))
    return toast('Usuario sin permisos', 'error');

  location.href = 'admin.html';
}

/* ---------- View ---------- */
function setView(v) {
  currentView = v;
  document.querySelectorAll('.zoneCard').forEach(b => {
    b.classList.toggle('active', b.dataset.view === v);
    b.setAttribute('aria-pressed', b.dataset.view === v);
  });
  $('viewTitle').textContent = v === 'completo' ? 'Vista completa' : zones[v].title;
  render();
}

/* ---------- Render Map ---------- */
function render() {
  const f = eventInfo();
  $('summaryEvent').textContent = f ? f.text : 'Sin función';

  const map = $('seatMap');
  map.innerHTML = '';

  if (!f) { updateSummary(); return; }

  map.innerHTML = '<div class="stage">ESCENARIO</div><div class="zoneTitle">' +
    (currentView === 'completo' ? 'Vista completa' : zones[currentView].title) +
    '</div>';

  (currentView === 'completo' ? ['patio', 'preferencia', 'palcos'] : [currentView]).forEach(v => {
    if (currentView === 'completo')
      map.insertAdjacentHTML('beforeend', '<div class="zoneTitle">' + zones[v].title + '</div>');
    v === 'palcos' ? renderPalcos(map) : renderRows(map, v);
  });

  updateSummary();
}

function getRowConfig(zone, rowNum) {
  const z = zones[zone];
  if (z.rowRanges) {
    for (const range of z.rowRanges) {
      if (rowNum >= range.from && rowNum <= range.to) return range;
    }
  }
  return z;
}

function renderRows(map, v) {
  const startRow = zones[v].startRow || 1;
  for (let r = startRow; r <= zones[v].rows; r++) {
    const cfg = getRowConfig(v, r);
    const row = document.createElement('div');
    row.className = 'row';
    cfg.odds.forEach(n => row.appendChild(btn(v, r, n)));
    row.appendChild(Object.assign(document.createElement('span'), { className: 'aisle' }));
    row.appendChild(Object.assign(document.createElement('span'), { className: 'rowLabel', textContent: r }));
    row.appendChild(Object.assign(document.createElement('span'), { className: 'aisle' }));
    const mainEvens = cfg.evens.filter(n => n <= 18);
    const extraEvens = cfg.evens.filter(n => n > 18);
    mainEvens.forEach(n => row.appendChild(btn(v, r, n)));
    if (extraEvens.length) {
      const gap = document.createElement('span');
      gap.className = 'seatGap';
      row.appendChild(gap);
      extraEvens.forEach(n => row.appendChild(btn(v, r, n)));
    }
    map.appendChild(row);
  }
}

function renderPalcos(map) {
  const wrap = document.createElement('div');
  wrap.className = 'palcosExcel';
  palcoGroups.forEach(g => {
    const col = document.createElement('div');
    col.className = 'palcoCol';
    col.innerHTML = '<h3>' + g.title + '</h3>';
    g.nums.forEach((n, i) => col.appendChild(btn('palcos', g.key, n, g.title, i + 1)));
    wrap.appendChild(col);
  });
  map.appendChild(wrap);
}

function btn(zone, row, num, labelZone = null, fila = null) {
  const b = document.createElement('button');
  b.className = 'seat ' + (zone === 'preferencia' ? 'preferencia' : zone === 'palcos' ? 'palco' : '');
  b.textContent = num;

  const coord = zone === 'palcos' ? `palcos-${row}-${num}` : `${zone}-${row}-${num}`;
  const st = statuses.get(coord);

  if (st) b.classList.add(st);
  if (selected.has(coord)) b.classList.add('selected');

  b.setAttribute('aria-label',
    `${labelZone || zones[zone].title} fila ${fila || row} butaca ${num} — ${st === 'libre' || !st ? 'disponible' : st}`
  );

  b.onclick = () => {
    if (st && st !== 'libre') return;
    if (selected.has(coord)) {
      selected.delete(coord);
    } else {
      selected.set(coord, {
        coord,
        zone: labelZone || zones[zone].title,
        fila: fila || row,
        label: num,
        price: zones[zone].price
      });
    }
    render();
  };

  return b;
}

/* ---------- Summary ---------- */
function updateSummary() {
  const vals = [...selected.values()];
  const count = vals.length;
  const subtotal = vals.reduce((s, v) => s + v.price, 0);
  const gestionTotal = count * GESTION_FEE;
  const total = subtotal + gestionTotal;

  $('count').textContent = count;
  $('total').innerHTML = count
    ? `<span class="summaryBreakdown"><small>${count} × ${vals[0]?.price || 0}€ + ${count} × ${GESTION_FEE}€ gestión</small></span> ${total.toFixed(2)} €`
    : '0 €';
  $('checkout').disabled = !eventInfo() || !count;

  $('selectedList').innerHTML = count
    ? vals.map(v =>
      `<div><strong>${v.zone}</strong><br>${v.zone.startsWith('PALCOS') ? 'Plaza' : 'Fila'} ${v.fila} · Butaca ${v.label} · ${v.price} €</div>`
    ).join('')
    : '';
}

/* ---------- Steps ---------- */
function step(s) {
  $('buyerStep').classList.toggle('hidden', s !== 'buyer');
  $('attendeesStep').classList.toggle('hidden', s !== 'att');
  $('paymentStep').classList.toggle('hidden', s !== 'pay');
  $('step1').className = 'step' + (s === 'buyer' ? ' active' : (s !== 'buyer' ? ' done' : ''));
  $('step2').className = 'step' + (s === 'att' ? ' active' : (s === 'pay' ? ' done' : ''));
  $('step3').className = 'step' + (s === 'pay' ? ' active' : '');
}

function openCheckout() {
  const f = eventInfo();
  if (!f) return;
  $('checkoutOverlay').classList.remove('hidden');
  document.body.classList.add('modalOpen');
  $('checkoutEventName').textContent = f.text;
  step('buyer');
}

/* ---------- Checkout Flow ---------- */
let buyer, attendees = [];

function goAttendees() {
  buyer = {
    nombre: $('buyerName').value.trim(),
    apellidos: $('buyerSurname').value.trim(),
    dni: $('buyerDni').value.trim().toUpperCase(),
    email: $('buyerEmail').value.trim(),
    telefono: $('buyerPhone').value.trim()
  };

  if (Object.values(buyer).some(x => !x))
    return err($('buyerStep'), 'Rellena todos los datos.');
  if (!validDni(buyer.dni))
    return err($('buyerStep'), 'DNI incorrecto. Debe tener 8 dígitos y una letra.');

  $('attendeeForms').innerHTML = '';
  [...selected.values()].forEach((s, i) => {
    const use = i === 0 && $('buyerAttends').checked;
    $('attendeeForms').insertAdjacentHTML('beforeend', `
      <div class="attendeeCard">
        <h4>Entrada ${i + 1}</h4>
        <div class="seatMeta">${s.zone}<br>${s.zone.startsWith('PALCOS') ? 'Plaza' : 'Fila'} ${s.fila} · Butaca ${s.label}</div>
        <label>Nombre *
          <input class="an" value="${use ? buyer.nombre : ''}" required>
        </label>
        <label>Apellidos *
          <input class="as" value="${use ? buyer.apellidos : ''}" required>
        </label>
        <label>DNI *
          <input class="ad" maxlength="9" value="${use ? buyer.dni : ''}" required>
        </label>
      </div>`
    );
  });
  step('att');
}

function goPayment() {
  attendees = [];
  const dnis = new Set();
  const cards = [...document.querySelectorAll('.attendeeCard')];
  const seatVals = [...selected.values()];

  for (let i = 0; i < cards.length; i++) {
    const a = {
      nombre: cards[i].querySelector('.an').value.trim(),
      apellidos: cards[i].querySelector('.as').value.trim(),
      dni: cards[i].querySelector('.ad').value.trim().toUpperCase(),
      seat: seatVals[i]
    };

    if (!a.nombre || !a.apellidos || !a.dni)
      return err($('attendeesStep'), 'Faltan datos en entrada ' + (i + 1));
    if (!validDni(a.dni))
      return err($('attendeesStep'), 'DNI incorrecto en entrada ' + (i + 1) + '. Debe tener 8 dígitos y una letra.');
    if (dnis.has(a.dni))
      return err($('attendeesStep'), 'DNI repetido: ' + a.dni);

    dnis.add(a.dni);
    attendees.push(a);
  }

  const f = eventInfo();
  const subtotal = attendees.reduce((s, a) => s + a.seat.price, 0);
  const gestionTotal = attendees.length * GESTION_FEE;
  const totalConGestion = subtotal + gestionTotal;

  $('paymentSummary').innerHTML = `
    <strong>Función:</strong> ${f.text}<br>
    <strong>Comprador:</strong> ${buyer.nombre} ${buyer.apellidos}<br>
    <hr style="margin:10px 0;border:none;border-top:1px solid #e2e8f0">
    <div class="paymentBreakdown">
      <span>Entradas (${attendees.length} × ${attendees[0].seat.price}€)</span>
      <strong>${subtotal.toFixed(2)} €</strong>
    </div>
    <div class="paymentBreakdown gestion">
      <span>Gestión (${attendees.length} × ${GESTION_FEE}€)</span>
      <strong>${gestionTotal.toFixed(2)} €</strong>
    </div>
    <div class="paymentBreakdown total">
      <span>Total a pagar</span>
      <strong>${totalConGestion.toFixed(2)} €</strong>
    </div>
    <hr style="margin:10px 0;border:none;border-top:1px solid #e2e8f0">
    ${attendees.map((a, i) =>
      `Entrada ${i + 1}: ${a.nombre} ${a.apellidos} · ${a.dni} · ${a.seat.zone} ${a.seat.fila}/${a.seat.label}`
    ).join('<br>')}
  `;
  step('pay');
}

/* ---------- Verify Availability ---------- */
async function verify(f) {
  const ids = attendees.map(a => seatByCoord.get(a.seat.coord)?.id).filter(Boolean);
  if (ids.length !== attendees.length) return false;

  const { data } = await sb.from('event_seats')
    .select('estado, seat_id')
    .eq('event_id', f.id)
    .in('seat_id', ids);

  if ((data || []).some(r => r.estado && r.estado !== 'libre')) return false;

  const { data: t } = await sb.from('tickets')
    .select('seat_id')
    .eq('event_id', f.id)
    .in('seat_id', ids)
    .neq('estado', 'cancelada');

  return !(t || []).length;
}

/* ---------- Create Order ---------- */
async function createOrder() {
  const f = eventInfo();

  if (!await verify(f)) {
    selected.clear();
    await loadStatuses();
    toast('La butaca ya no está disponible. El plano se ha actualizado.', 'error');
    return;
  }

  const method = document.querySelector('input[name="payMethod"]:checked').value;
  const estado = method === 'bizum' ? 'pendiente_bizum' : 'pagado';
  const now = Date.now();
  const num = 'CARN-2026-' + String(now).slice(-6);
  const subtotal = attendees.reduce((s, a) => s + a.seat.price, 0);
  const gestionTotal = attendees.length * GESTION_FEE;
  const total = subtotal + gestionTotal;

  const { data: order, error } = await sb.from('orders').insert({
    numero_pedido: num,
    event_id: f.id,
    comprador_nombre: buyer.nombre,
    comprador_apellidos: buyer.apellidos,
    comprador_dni: buyer.dni,
    comprador_email: buyer.email,
    comprador_telefono: buyer.telefono,
    metodo_pago: method,
    estado,
    total
  }).select().single();

  if (error) return toast('No se pudo crear el pedido.', 'error');

  const made = [];
  for (let i = 0; i < attendees.length; i++) {
    const a = attendees[i];
    const seat = seatByCoord.get(a.seat.coord);
    const qrToken = crypto.randomUUID();
    const { data: t, error: te } = await sb.from('tickets').insert({
      numero_entrada: 'ENT-' + String(now).slice(-6) + '-' + (i + 1),
      order_id: order.id,
      event_id: f.id,
      seat_id: seat.id,
      nombre: a.nombre,
      apellidos: a.apellidos,
      dni: a.dni,
      qr_token: qrToken,
      estado: estado === 'pagado' ? 'generada' : 'pendiente'
    }).select('*, seats(*)').single();

    if (te) {
      selected.clear();
      await loadStatuses();
      toast('La butaca ya no está disponible. El plano se ha actualizado.', 'error');
      return;
    }

    made.push(t);
    await sb.from('event_seats').upsert({
      event_id: f.id,
      seat_id: seat.id,
      estado: estado === 'pagado' ? 'vendida' : 'pendiente_bizum',
      precio: a.seat.price
    }, { onConflict: 'event_id,seat_id' });
  }

  selected.clear();
  $('checkoutOverlay').classList.add('hidden');
  document.body.classList.remove('modalOpen');
  await loadStatuses();

  if (estado === 'pagado') {
    toast('¡Pedido creado! Entrada generada.', 'success');
    renderTicketDocuments($('ticketsList'), made, f.text, order.numero_pedido);
    $('ticketOverlay').classList.remove('hidden');
    document.body.classList.add('modalOpen');
  } else {
    toast('Pedido pendiente de Bizum. La entrada se generará cuando el admin confirme.', 'info');
  }
}

init();
