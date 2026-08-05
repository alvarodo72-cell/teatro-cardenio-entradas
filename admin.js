const $ = id => document.getElementById(id),
      sb = window.sb,
      { zones, palcoGroups } = window.CARDENIO;

const GESTION_FEE = 2.5;

let events = [], orders = [];
let taquillaSeats = [], taquillaSeatByCoord = new Map(), taquillaStatuses = new Map();
let taquillaSelected = new Map();
let taquillaCurrentView = 'patio';
let wizardStep = 1;

/* ============================================
   HELPERS
   ============================================ */
function toast(msg, type = 'info') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
function validDni(d) { return /^[0-9]{8}[A-Za-z]$/.test((d || '').trim()); }
function eventInfo() {
  const e = $('eventId');
  return e.value ? { id: e.value, text: e.options[e.selectedIndex].text } : null;
}
function getTaquillaPayType() {
  const c = document.querySelector('input[name="taquillaPayType"]:checked');
  return c ? c.value : 'efectivo';
}
function numSeats(filas, butIzq, butDer) { return filas * (butIzq + butDer); }

/* ============================================
   INIT
   ============================================ */
async function init() {
  let session;
  try {
    const res = await sb.auth.getSession();
    session = res.data.session;
  } catch(e) { console.error('getSession error:', e); }

  if (!session) {
    $('loginOverlay').classList.remove('hidden');
    $('loginForm').addEventListener('submit', e => { e.preventDefault(); login(); });
    return;
  }

  try {
    const { data: p } = await sb.from('profiles').select('rol').eq('id', session.user.id).single();
    if (!p || !['superadmin', 'taquilla'].includes(p.rol)) { toast('Sin permisos', 'error'); return location.href = 'index.html'; }
  } catch(e) { console.warn('Profile check error:', e); }

  try { bind(); } catch(e) { console.error('Bind error:', e); }
  await loadEvents().catch(e => console.error(e));
  await loadValidadosEvents().catch(e => console.error(e));
  await refresh().catch(e => console.error(e));
  await taquillaLoadSeats().catch(e => console.error(e));
  try { wizardUpdatePreviews(); } catch(e) {}
  try { bindWizardInputs(); } catch(e) {}
  const excelInput = $('wizExcelInput');
  if (excelInput) excelInput.addEventListener('paste', () => { setTimeout(parseExcelLayout, 100); });
}

/* ============================================
   BINDINGS
   ============================================ */
function bind() {
  document.querySelectorAll('.adminNav button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.adminNav button').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      $(b.dataset.tab).classList.add('active');
      if (b.dataset.tab === 'taquilla') taquillaRefresh();
      else if (b.dataset.tab === 'gestion') renderGestion();
      else refresh();
    };
  });
  $('logoutAdmin').onclick = async () => { await sb.auth.signOut(); location.href = 'index.html'; };
  $('eventId').onchange = async () => { await refresh(); await taquillaLoadStatuses(); };
  $('searchBtn').onclick = search;
  $('closeTickets').onclick = () => {
    $('ticketOverlay').classList.add('hidden');
    document.body.classList.remove('modalOpen');
    const actionsBar = $('ticketActionsBar');
    if (actionsBar) actionsBar.style.display = 'none';
    const fab = $('fabQr');
    if (fab) fab.style.display = 'none';
    currentOrderForActions = null;
    currentTicketsForActions = [];
  };
  $('qrRegenBtn').onclick = () => {
    if (currentTicketsForActions.length === 1) {
      regenerateTicketQr(currentTicketsForActions[0].id);
    } else if (currentTicketsForActions.length > 1) {
      toast('Selecciona una entrada concreta para regenerar su QR.', 'info');
    }
  };
  $('whatsappBtn').onclick = () => {
    if (currentTicketsForActions.length === 1) {
      sendWhatsApp(currentTicketsForActions[0].id);
    } else if (currentTicketsForActions.length > 1) {
      toast('Usa el botón WhatsApp en la tabla de entradas para cada una.', 'info');
    }
  };
  const compSearch = $('comprasSearch');
  if (compSearch) compSearch.addEventListener('keydown', e => { if (e.key === 'Enter') filterOrders(); });
  $('printTickets').onclick = () => {
    const overlay = $('ticketOverlay');
    if (overlay) { overlay.classList.remove('hidden'); document.body.classList.add('modalOpen'); }
    setTimeout(() => window.print(), 100);
  };
  $('downloadPdf').onclick = downloadTicketPdf;
  document.querySelectorAll('#taquilla .zoneCard').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#taquilla .zoneCard').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
      taquillaCurrentView = b.dataset.view; taquillaRenderMap();
    };
  });
  $('taquillaGenerateBtn').onclick = taquillaGenerate;
  $('taquillaClearBtn').onclick = taquillaClear;
  document.querySelectorAll('input[name="taquillaPayType"]').forEach(r => { r.onchange = taquillaRenderSelected });

  const vSel = $('validadosEventSelect');
  if (vSel) {
    vSel.onchange = () => loadValidados(vSel.value);
  }
  const vSearch = $('validadosSearch');
  if (vSearch) vSearch.addEventListener('keydown', e => { if (e.key === 'Enter') filterValidados(); });
}

/* ============================================
   EVENTS & ORDERS
   ============================================ */
async function loadEvents() {
  const { data } = await sb.from('events').select('*').order('fecha').order('hora');
  events = data || [];
  $('eventId').innerHTML = events.map(e => `<option value="${e.id}">${e.nombre} · ${e.fecha} · ${String(e.hora).slice(0,5)} (${e.estado})</option>`).join('') || '<option value="">Sin funciones</option>';
  renderEvents();
}
async function refresh() {
  const f = eventInfo();
  if (!f) { orders = []; return; }
  const { data } = await sb.from('orders').select('*, tickets(*, seats(*))').eq('event_id', f.id).order('created_at', { ascending: false });
  orders = data || [];
  renderKpis(); renderOrders(); renderPending(); updateBizumBadge();
}
function renderEvents() {
  $('eventsList').innerHTML = events.length ? events.map(e => `
    <div class="eventItem">
      <div><strong>${e.nombre}</strong><br><small>${e.fecha} · ${String(e.hora).slice(0,5)} · ${e.estado}</small></div>
      <div class="eventActions">
        <button class="ok" onclick="setEventStatus('${e.id}','activo')">Activar</button>
        <button class="warn" onclick="setEventStatus('${e.id}','cerrado')">Cerrar</button>
        <button class="dark" onclick="setEventStatus('${e.id}','oculto')">Ocultar</button>
        <button class="light" onclick="editEvent('${e.id}')">✏️ Editar</button>
        <button class="danger" onclick="deleteEvent('${e.id}','${e.nombre}')">🗑️</button>
      </div>
    </div>`).join('') : '<div class="emptyState">No hay funciones.</div>';
}
async function setEventStatus(id, estado) {
  await sb.from('events').update({ estado }).eq('id', id);
  toast('Estado actualizado', 'success'); await loadEvents(); refresh();
}
function editEvent(id) {
  const e = events.find(x => x.id === id);
  if (!e) return;
  $('editEventId').value = e.id;
  $('editEventNombre').value = e.nombre;
  $('editEventFecha').value = e.fecha;
  $('editEventHora').value = String(e.hora).slice(0,5);
  $('editEventEstado').value = e.estado;
  $('editEventDesc').value = e.descripcion || '';
  $('editEventOverlay').classList.remove('hidden');
  document.body.classList.add('modalOpen');
}
async function saveEditEvent() {
  const id = $('editEventId').value;
  const nombre = $('editEventNombre').value.trim();
  const fecha = $('editEventFecha').value;
  const hora = $('editEventHora').value;
  const estado = $('editEventEstado').value;
  const descripcion = $('editEventDesc').value.trim();
  if (!nombre || !fecha || !hora) return toast('Faltan datos.', 'error');
  await sb.from('events').update({ nombre, fecha, hora, estado, descripcion }).eq('id', id);
  $('editEventOverlay').classList.add('hidden');
  document.body.classList.remove('modalOpen');
  toast('Evento actualizado', 'success');
  await loadEvents(); refresh();
}
async function deleteEvent(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"? Se borrarán todos los pedidos y entradas asociados.`)) return;
  const { data: ords } = await sb.from('orders').select('id').eq('event_id', id);
  if (ords && ords.length > 0) {
    const orderIds = ords.map(o => o.id);
    await sb.from('tickets').delete().in('order_id', orderIds);
    await sb.from('orders').delete().in('id', orderIds);
  }
  await sb.from('event_seats').delete().eq('event_id', id);
  await sb.from('events').delete().eq('id', id);
  toast('Evento eliminado', 'success');
  await loadEvents(); refresh();
}

/* ============================================
   DASHBOARD KPIs
   ============================================ */
function renderKpis() {
  const f = eventInfo();
  const isTaq = o => (o.numero_pedido || '').startsWith('TAQ-');
  const isWeb = o => !isTaq(o);
  const allT = o => o.tickets?.length || 0;
  const webPaid = orders.filter(o => isWeb(o) && o.estado === 'pagado');
  const taqCobro = orders.filter(o => isTaq(o) && o.estado === 'pagado' && Number(o.total) > 0);
  const taqInvit = orders.filter(o => isTaq(o) && Number(o.total) === 0);
  const pendOrders = orders.filter(o => o.estado === 'pendiente_bizum');
  const webTickets = webPaid.reduce((s,o) => s+allT(o), 0);
  const taqCobroTickets = taqCobro.reduce((s,o) => s+allT(o), 0);
  const taqInvitTickets = taqInvit.reduce((s,o) => s+allT(o), 0);
  const pendTickets = pendOrders.reduce((s,o) => s+allT(o), 0);
  const totalSold = webTickets + taqCobroTickets;
  const webRevenue = webPaid.reduce((s,o) => s+Number(o.total||0), 0);
  const taqRevenue = taqCobro.reduce((s,o) => s+Number(o.total||0), 0);
  const totalRevenue = webRevenue + taqRevenue;
  const webGastos = webTickets * GESTION_FEE;
  const taqGastos = taqCobroTickets * GESTION_FEE;
  const totalGastos = webGastos + taqGastos;
  const beneficioNeto = totalRevenue + totalGastos;
  $('kSold').textContent = totalSold;
  $('kPending').textContent = pendTickets;
  $('kRevenue').textContent = totalRevenue + ' €';
  $('adminEventText').textContent = f?.text || 'Sin función seleccionada';
  const d = $('dashBreakdown');
  if (d) d.innerHTML = `
    <div class="kpi kpiBreakdown"><span>🌐 Venta web</span><strong>${webTickets} entrada${webTickets!==1?'s':''}</strong>
      <small>Precio entrada: ${webRevenue.toFixed(2)} €</small><small class="kpiMinus">+ Gestión: +${webGastos.toFixed(2)} €</small>
      <small class="kpiCobrado">Cobrado: ${(webRevenue+webGastos).toFixed(2)} €</small></div>
    <div class="kpi kpiBreakdown"><span>💵 Efectivo taquilla</span><strong>${taqCobroTickets} entrada${taqCobroTickets!==1?'s':''}</strong>
      <small>Precio entrada: ${taqRevenue.toFixed(2)} €</small><small class="kpiMinus">+ Gestión: +${taqGastos.toFixed(2)} €</small>
      <small class="kpiCobrado">Cobrado: ${(taqRevenue+taqGastos).toFixed(2)} €</small></div>
    <div class="kpi kpiBreakdown"><span>🎁 Invitaciones</span><strong>${taqInvitTickets} entrada${taqInvitTickets!==1?'s':''}</strong>
      <small>Precio: 0,00 €</small><small>Gestión: 0,00 €</small>
      <small class="kpiNet invitacion">Coste: 0,00 €</small></div>
    <div class="kpi kpiBreakdown kpiTotal"><span>📊 Total</span><strong>${totalSold+taqInvitTickets} entrada${(totalSold+taqInvitTickets)!==1?'s':''}</strong>
      <small>Entradas: ${totalRevenue.toFixed(2)} €</small><small class="kpiMinus">+ Gestión: +${totalGastos.toFixed(2)} €</small>
      <small class="kpiCobrado">Total: ${(totalRevenue+totalGastos).toFixed(2)} €</small><small class="kpiNetTotal">Beneficio: ${beneficioNeto.toFixed(2)} €</small></div>`;
}

/* ============================================
   GESTIÓN TAB
   ============================================ */
function renderGestion() {
  const isTaq = o => (o.numero_pedido || '').startsWith('TAQ-');
  const isWeb = o => !isTaq(o);
  const allT = o => o.tickets?.length || 0;
  const webPaid = orders.filter(o => isWeb(o) && o.estado === 'pagado');
  const taqCobro = orders.filter(o => isTaq(o) && o.estado === 'pagado' && Number(o.total) > 0);
  const taqInvit = orders.filter(o => isTaq(o) && Number(o.total) === 0);
  const webTickets = webPaid.reduce((s,o) => s+allT(o), 0);
  const taqCobroTickets = taqCobro.reduce((s,o) => s+allT(o), 0);
  const taqInvitTickets = taqInvit.reduce((s,o) => s+allT(o), 0);
  const totalTickets = webTickets + taqCobroTickets + taqInvitTickets;
  const webRevenue = webPaid.reduce((s,o) => s+Number(o.total||0), 0);
  const taqRevenue = taqCobro.reduce((s,o) => s+Number(o.total||0), 0);
  const totalRevenue = webRevenue + taqRevenue;
  const webGest = webTickets * GESTION_FEE;
  const taqGest = taqCobroTickets * GESTION_FEE;
  const totalGest = webGest + taqGest;
  const totalCobrado = totalRevenue + totalGest;
  const f = eventInfo();
  const totalCapacity = 0;
  const soldPct = totalTickets > 0 ? Math.round((totalTickets / Math.max(totalTickets, 1)) * 100) : 0;

  $('gestionSummary').innerHTML = `
    <div class="gestionHeader">
      <h3>📊 Resumen económico</h3>
      <p>${f?.text || ''}</p>
    </div>

    <div class="gestionKpiRow">
      <div class="gestionKpiCard blue">
        <div class="gestionKpiIcon">🎫</div>
        <div class="gestionKpiData">
          <span>Entradas vendidas</span>
          <strong>${totalTickets}</strong>
          <small>${webTickets} web · ${taqCobroTickets} taquilla · ${taqInvitTickets} invit.</small>
        </div>
      </div>
      <div class="gestionKpiCard green">
        <div class="gestionKpiIcon">💰</div>
        <div class="gestionKpiData">
          <span>Recaudación entradas</span>
          <strong>${totalRevenue.toFixed(2)} €</strong>
          <small>Solo ventas (sin gestión)</small>
        </div>
      </div>
      <div class="gestionKpiCard orange">
        <div class="gestionKpiIcon">📋</div>
        <div class="gestionKpiData">
          <span>Gestión cobrada</span>
          <strong>${totalGest.toFixed(2)} €</strong>
          <small>${GESTION_FEE}€ × ${webTickets + taqCobroTickets} entradas</small>
        </div>
      </div>
      <div class="gestionKpiCard total">
        <div class="gestionKpiIcon">✅</div>
        <div class="gestionKpiData">
          <span>Total facturado</span>
          <strong>${totalCobrado.toFixed(2)} €</strong>
          <small>Entradas + gestión</small>
        </div>
      </div>
    </div>

    <div class="gestionBreakdownGrid">
      <div class="gestionBreakdownCard">
        <h4>🌐 Venta web</h4>
        <div class="gestionBreakdownRows">
          <div class="gestionBRow"><span>Entradas</span><strong>${webTickets}</strong></div>
          <div class="gestionBRow"><span>Precio entradas</span><strong>${webRevenue.toFixed(2)} €</strong></div>
          <div class="gestionBRow highlight"><span>Gestión (+${GESTION_FEE}€/ud)</span><strong>+${webGest.toFixed(2)} €</strong></div>
          <div class="gestionBRow total"><span>Cobrado web</span><strong>${(webRevenue + webGest).toFixed(2)} €</strong></div>
        </div>
      </div>
      <div class="gestionBreakdownCard">
        <h4>💵 Taquilla (efectivo)</h4>
        <div class="gestionBreakdownRows">
          <div class="gestionBRow"><span>Entradas</span><strong>${taqCobroTickets}</strong></div>
          <div class="gestionBRow"><span>Precio entradas</span><strong>${taqRevenue.toFixed(2)} €</strong></div>
          <div class="gestionBRow highlight"><span>Gestión (+${GESTION_FEE}€/ud)</span><strong>+${taqGest.toFixed(2)} €</strong></div>
          <div class="gestionBRow total"><span>Cobrado taquilla</span><strong>${(taqRevenue + taqGest).toFixed(2)} €</strong></div>
        </div>
      </div>
      <div class="gestionBreakdownCard">
        <h4>🎁 Invitaciones</h4>
        <div class="gestionBreakdownRows">
          <div class="gestionBRow"><span>Entradas</span><strong>${taqInvitTickets}</strong></div>
          <div class="gestionBRow"><span>Precio entradas</span><strong>0,00 €</strong></div>
          <div class="gestionBRow"><span>Gestión</span><strong>0,00 €</strong></div>
          <div class="gestionBRow total"><span>Total</span><strong>0,00 €</strong></div>
        </div>
      </div>
      <div class="gestionBreakdownCard summary">
        <h4>📊 Resumen total</h4>
        <div class="gestionBRow"><span>Precio entradas</span><strong>${totalRevenue.toFixed(2)} €</strong></div>
        <div class="gestionBRow highlight"><span>Gestión total</span><strong>+${totalGest.toFixed(2)} €</strong></div>
        <div class="gestionBRow final"><span>Facturado</span><strong>${totalCobrado.toFixed(2)} €</strong></div>
      </div>
    </div>

    <div class="gestionTableWrap">
      <h4>📋 Detalle por pedido</h4>
      <table class="table">
        <tr><th>Pedido</th><th>Canal</th><th>Entradas</th><th>Precio base</th><th>Gestión</th><th>Total</th></tr>
        ${orders.filter(o => o.estado === 'pagado').map(o => {
          const isTaqOrder = (o.numero_pedido||'').startsWith('TAQ-');
          const isInv = isTaqOrder && Number(o.total) === 0;
          const canal = isInv ? '🎁 Invitación' : isTaqOrder ? '💵 Taquilla' : o.metodo_pago === 'bizum' ? '📲 Bizum' : '🌐 Web';
          const nTickets = allT(o);
          const gest = isInv ? 0 : nTickets * GESTION_FEE;
          return `<tr><td>${o.numero_pedido}</td><td>${canal}</td><td>${nTickets}</td><td>${(Number(o.total)-gest).toFixed(2)} €</td><td>${gest.toFixed(2)} €</td><td><strong>${Number(o.total).toFixed(2)} €</strong></td></tr>`;
        }).join('')}
      </table>
    </div>`;
}

/* ============================================
   ORDERS TABLE, BIZUM, SEARCH
   ============================================ */
function renderOrders(filter = '') {
  let list = orders;
  if (filter) {
    const q = filter.toLowerCase();
    list = orders.filter(o => {
      const txt = ((o.numero_pedido||'') + ' ' + (o.comprador_nombre||'') + ' ' + (o.comprador_apellidos||'') + ' ' + (o.comprador_dni||'')).toLowerCase();
      return txt.includes(q);
    });
  }
  $('ordersTable').innerHTML = `<tr><th>Pedido</th><th>Canal</th><th>Comprador</th><th>Entradas</th><th>Total</th><th>Estado</th><th>Acciones</th></tr>
    ${list.map(o => { const isTaq=(o.numero_pedido||'').startsWith('TAQ-'); const isInv=isTaq&&Number(o.total)===0;
      const canal=isInv?'🎁 Invitación':isTaq?'💵 Taquilla':o.metodo_pago==='bizum'?'📲 Bizum':'🌐 Web';
      const canCancel=o.estado==='pagado'||(isTaq&&o.estado==='pagado');
      return `<tr><td>${o.numero_pedido}</td><td>${canal}</td><td>${o.comprador_nombre} ${o.comprador_apellidos}<br><small>${o.comprador_dni}</small></td><td>${o.tickets?.length||0}</td><td>${o.total} €</td><td>${o.estado}</td><td class="orderActions">${o.estado==='pendiente_bizum'?`<button class="orderBtn" onclick="confirmBizum('${o.id}')">Confirmar Bizum</button>`:`<button class="orderBtn" onclick="showOrder('${o.id}')">Ver entrada</button>`}${canCancel?`<button class="orderBtn danger" onclick="cancelOrder('${o.id}')">Cancelar</button>`:''}</td></tr>`;}).join('')}`;
}
function filterOrders() { const q = ($('comprasSearch')?.value || '').trim(); renderOrders(q); }
function renderPending() {
  const ps=orders.filter(o=>o.estado==='pendiente_bizum');
  $('pendingBizum').innerHTML=ps.length?ps.map(o=>`<div class="kpi" style="margin-bottom:10px"><strong>${o.numero_pedido}</strong><p>${o.comprador_nombre} ${o.comprador_apellidos} — ${o.total} €</p><button class="orderBtn" onclick="confirmBizum('${o.id}')">Confirmar y generar entrada</button></div>`).join(''):'<div class="emptyState">No hay pagos Bizum pendientes.</div>';
}
function updateBizumBadge(){const c=orders.filter(o=>o.estado==='pendiente_bizum').length;const b=$('bizumBadge');if(b){b.textContent=c;b.style.display=c>0?'':'none';}}
async function confirmBizum(id){const o=orders.find(x=>x.id===id);if(!o)return;await sb.from('orders').update({estado:'pagado'}).eq('id',id);await sb.from('tickets').update({estado:'generada'}).eq('order_id',id);for(const t of o.tickets||[])await sb.from('event_seats').upsert({event_id:o.event_id,seat_id:t.seat_id,estado:'vendida',precio:t.seats?.precio_base||0},{onConflict:'event_id,seat_id'});toast('Bizum confirmado.','success');await refresh();showOrder(id);}
async function cancelOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return;
  if(!confirm(`¿Cancelar el pedido ${o.numero_pedido}? Las entradas quedarán anuladas y las butacas se liberarán.`))return;
  await sb.from('orders').update({estado:'cancelado'}).eq('id',id);
  await sb.from('tickets').update({estado:'cancelada'}).eq('order_id',id);
  for(const t of o.tickets||[])await sb.from('event_seats').upsert({event_id:o.event_id,seat_id:t.seat_id,estado:'libre',precio:0},{onConflict:'event_id,seat_id'});
  toast('Pedido cancelado. Butacas liberadas.','success');
  await refresh();
}
/* ============================================
   CÓDIGOS VALIDADOS
   ============================================ */
let validadosTickets = [];

async function loadValidadosEvents() {
  const { data } = await sb.from('events').select('*').order('fecha', { ascending: false });
  const sel = $('validadosEventSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona evento...</option>' +
    (data || []).map(e => `<option value="${e.id}">${e.nombre} · ${e.fecha}</option>`).join('');
}

async function loadValidados(eventId) {
  const empty = $('validadosEmpty');
  const tableWrap = $('validadosTableWrap');
  const stats = $('validadosStats');

  if (!eventId) {
    empty.style.display = '';
    empty.textContent = 'Selecciona un evento para ver los códigos validados.';
    tableWrap.style.display = 'none';
    stats.style.display = 'none';
    validadosTickets = [];
    return;
  }

  const { data: tickets } = await sb.from('tickets')
    .select('*, seats(zona, fila, butaca), orders(numero_pedido, comprador_telefono)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  validadosTickets = tickets || [];

  const total = validadosTickets.length;
  const usadas = validadosTickets.filter(t => t.estado === 'usada').length;
  const pendientes = validadosTickets.filter(t => t.estado === 'generada').length;
  const canceladas = validadosTickets.filter(t => t.estado === 'cancelada').length;

  $('vTotal').textContent = total;
  $('vUsadas').textContent = usadas;
  $('vPendientes').textContent = pendientes;
  $('vCanceladas').textContent = canceladas;

  empty.style.display = 'none';
  stats.style.display = '';
  tableWrap.style.display = '';

  renderValidadosTable(validadosTickets);
}

function renderValidadosTable(list) {
  const table = $('validadosTable');
  if (!list.length) {
    table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:#94a3b8">No hay entradas registradas para este evento.</td></tr>';
    return;
  }

  table.innerHTML = `<tr>
    <th>Estado</th>
    <th>Nº Entrada</th>
    <th>Nombre</th>
    <th>Apellidos</th>
    <th>DNI</th>
    <th>Zona</th>
    <th>Butaca</th>
    <th>Pedido</th>
    <th>Acciones</th>
  </tr>` + list.map(t => {
    const seat = t.seats || {};
    const order = t.orders || {};
    let badgeClass = 'badgeGenerada';
    let badgeLabel = 'Pendiente';
    if (t.estado === 'usada') { badgeClass = 'badgeUsada'; badgeLabel = 'Validada'; }
    else if (t.estado === 'cancelada') { badgeClass = 'badgeCancelada'; badgeLabel = 'Cancelada'; }
    else if (t.estado === 'generada') { badgeClass = 'badgeGenerada'; badgeLabel = 'Pendiente'; }
    else if (t.estado === 'pendiente_bizum') { badgeClass = 'badgePendiente'; badgeLabel = 'Pendiente'; }

    const canReactivate = t.estado === 'usada';
    const phone = order.comprador_telefono || '';
    const qrUrl = PUBLIC_TICKET_BASE_URL + '?token=' + encodeURIComponent(t.qr_token || '');
    const whatsappMsg = encodeURIComponent(`🎭 *Entrada Teatro Cardenio*\n\nHola ${t.nombre}, aquí tienes tu nueva entrada:\n\n👤 ${t.nombre} ${t.apellidos}\n🪪 ${t.dni}\n🪑 ${seat.zona || ''} F${seat.fila || ''} B${seat.butaca || ''}\n\n🔗 ${qrUrl}\n\nMuestra este enlace o código QR en la entrada.`);
    const canSendWhatsapp = phone && (t.estado === 'generada' || t.estado === 'usada');

    return `<tr>
      <td><span class="${badgeClass}">${badgeLabel}</span></td>
      <td><code>${t.numero_entrada || ''}</code></td>
      <td>${t.nombre || ''}</td>
      <td>${t.apellidos || ''}</td>
      <td><strong>${t.dni || ''}</strong></td>
      <td>${seat.zona || ''}</td>
      <td>${seat.fila ? 'F' + seat.fila : ''}${seat.butaca ? ' · B' + seat.butaca : ''}</td>
      <td><small>${order.numero_pedido || ''}</small></td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        ${canReactivate ? `<button class="reactivateBtn" onclick="reactivateTicket('${t.id}')">Reactivar</button>` : ''}
        <button class="qrRegenBtn" style="padding:5px 8px;font-size:11px;border-radius:6px" onclick="regenerateTicketQr('${t.id}')">🔄 QR</button>
        ${canSendWhatsapp ? `<a class="whatsappBtn" style="padding:5px 8px;font-size:11px;border-radius:6px;text-decoration:none;display:inline-flex" href="https://wa.me/${phone.replace(/\D/g,'')}?text=${whatsappMsg}" target="_blank">📱 WhatsApp</a>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function filterValidados() {
  const q = ($('validadosSearch')?.value || '').toLowerCase().trim();
  if (!q) return renderValidadosTable(validadosTickets);
  const filtered = validadosTickets.filter(t => {
    const txt = ((t.nombre||'') + ' ' + (t.apellidos||'') + ' ' + (t.dni||'') + ' ' + (t.numero_entrada||'')).toLowerCase();
    return txt.includes(q);
  });
  renderValidadosTable(filtered);
}

async function reactivateTicket(id) {
  if (!confirm('¿Reactivar esta entrada? Volverá a estar pendiente de validación.')) return;

  const { error } = await sb.from('tickets').update({ estado: 'generada' }).eq('id', id);
  if (error) return toast('Error: ' + error.message, 'error');

  toast('Entrada reactivada correctamente', 'success');

  const eventId = $('validadosEventSelect')?.value;
  if (eventId) await loadValidados(eventId);
}

/* ============================================
   REGENERAR QR Y ENVIAR POR WHATSAPP
   ============================================ */
let currentOrderForActions = null;
let currentTicketsForActions = [];

async function regenerateTicketQr(ticketId) {
  if (!confirm('¿Generar un nuevo código QR para esta entrada? El código anterior dejará de funcionar.')) return;

  const newToken = crypto.randomUUID();
  const newShort = (newToken || '').replace(/-/g, '').substring(0, 8).toUpperCase();

  const { error } = await sb.from('tickets')
    .update({ qr_token: newToken, short_code: newShort, estado: 'generada' })
    .eq('id', ticketId);

  if (error) return toast('Error al regenerar QR: ' + error.message, 'error');

  toast('QR regenerado correctamente', 'success');

  const eventId = $('validadosEventSelect')?.value;
  if (eventId) await loadValidados(eventId);

  if (currentOrderForActions) {
    const { data: updatedTickets } = await sb.from('tickets')
      .select('*, seats(*)')
      .eq('order_id', currentOrderForActions.id);
    if (updatedTickets) {
      currentTicketsForActions = updatedTickets;
      renderTicketDocuments($('ticketsList'), currentTicketsForActions, eventInfo()?.text || '', currentOrderForActions.numero_pedido, false);
      regenerateQrCodes(currentTicketsForActions);
    }
  }
}

function regenerateQrCodes(tickets) {
  setTimeout(() => {
    tickets.forEach((ticket, index) => {
      const target = document.getElementById('ticketQr-' + index);
      if (!target) return;
      target.innerHTML = '';
      try {
        new QRCode(target, {
          text: ticketQrUrl(ticket),
          width: 140,
          height: 140,
          colorDark: '#1a2332',
          colorLight: '#ffffff'
        });
      } catch (e) { target.textContent = 'Error QR'; }
    });
  }, 100);
}

function sendWhatsApp(ticketId) {
  const t = currentTicketsForActions.find(x => x.id === ticketId);
  if (!t) return;

  const order = currentOrderForActions || {};
  const phone = (order.comprador_telefono || '').replace(/\D/g, '');
  if (!phone) return toast('No hay teléfono de contacto', 'error');

  const seat = t.seats || {};
  const qrUrl = ticketQrUrl(t);
  const msg = encodeURIComponent(
    `🎭 *Entrada Teatro Cardenio*\n\n` +
    `Hola ${t.nombre}, aquí tienes tu entrada:\n\n` +
    `👤 ${t.nombre} ${t.apellidos}\n` +
    `🪪 ${t.dni}\n` +
    `🪑 ${seat.zona || ''} F${seat.fila || ''} B${seat.butaca || ''}\n\n` +
    `🔗 ${qrUrl}\n\n` +
    `Muestra este enlace o código QR en la entrada.`
  );

  window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
}

function showOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const isInv = (o.numero_pedido || '').startsWith('TAQ-') && Number(o.total) === 0;
  currentOrderForActions = o;
  currentTicketsForActions = o.tickets || [];

  renderTicketDocuments($('ticketsList'), currentTicketsForActions, eventInfo()?.text || '', o.numero_pedido, isInv);
  regenerateQrCodes(currentTicketsForActions);

  const actionsBar = $('ticketActionsBar');
  const fab = $('fabQr');
  if (actionsBar) actionsBar.style.display = '';
  if (fab) {
    fab.style.display = '';
    fab.onclick = () => {
      if (currentTicketsForActions.length === 1) {
        regenerateTicketQr(currentTicketsForActions[0].id);
      } else if (currentTicketsForActions.length > 1) {
        toast('Hay varias entradas. Usa el botón 🔄 QR en cada una.', 'info');
      }
    };
  }

  $('ticketOverlay').classList.remove('hidden');
  document.body.classList.add('modalOpen');
}
function search(){const q=$('searchInput').value.toLowerCase().trim();if(!q)return toast('Introduce un término.','info');const res=[];orders.forEach(o=>(o.tickets||[]).forEach(t=>{const txt=(o.numero_pedido+' '+t.numero_entrada+' '+t.nombre+' '+t.apellidos+' '+t.dni).toLowerCase();if(txt.includes(q))res.push({o,t});}));$('searchResults').innerHTML=res.length?`<table class="table"><tr><th>Entrada</th><th>Asistente</th><th>Pedido</th><th></th></tr>${res.map(x=>`<tr><td>${x.t.numero_entrada}</td><td>${x.t.nombre} ${x.t.apellidos}<br><small>${x.t.dni}</small></td><td>${x.o.numero_pedido}</td><td><button class="orderBtn" onclick="showOrder('${x.o.id}')">Ver</button></td></tr>`).join('')}</table>`:'<div class="emptyState">No encontrado.</div>';}

/* ============================================
   TAQUILLA
   ============================================ */
async function taquillaLoadSeats(){const{data,error}=await sb.from('seats').select('*');if(error)return toast('Error butacas','error');taquillaSeats=data||[];taquillaSeatByCoord=new Map(taquillaSeats.map(s=>[s.coord,s]));await taquillaLoadStatuses();}
async function taquillaLoadStatuses(){taquillaStatuses.clear();const f=eventInfo();if(!f){taquillaRenderMap();return;}const{data}=await sb.from('event_seats').select('estado, seats(coord)').eq('event_id',f.id);(data||[]).forEach(r=>{if(r.seats?.coord)taquillaStatuses.set(r.seats.coord,r.estado);});taquillaRenderMap();}
function taquillaRefresh(){taquillaRenderMap();taquillaRenderSelected();}
function taquillaRenderMap(){const map=$('taquillaSeatMap');if(!map)return;map.innerHTML='';const f=eventInfo();if(!f){map.innerHTML='<div class="emptyState" style="margin:40px">Selecciona una función.</div>';return;}map.innerHTML='<div class="stage">ESCENARIO</div><div class="zoneTitle">'+(taquillaCurrentView==='completo'?'Vista completa':zones[taquillaCurrentView].title)+'</div>';const vs=taquillaCurrentView==='completo'?['patio','preferencia','palcos']:[taquillaCurrentView];vs.forEach(v=>{if(taquillaCurrentView==='completo')map.insertAdjacentHTML('beforeend','<div class="zoneTitle">'+zones[v].title+'</div>');v==='palcos'?taquillaRenderPalcos(map):taquillaRenderRows(map,v);});}
function taquillaRenderRows(map,v){const startRow=zones[v].startRow||1;for(let r=startRow;r<=zones[v].rows;r++){let cfg=zones[v];if(zones[v].rowRanges){for(const range of zones[v].rowRanges){if(r>=range.from&&r<=range.to){cfg=range;break;}}}const row=document.createElement('div');row.className='row';cfg.odds.forEach(n=>row.appendChild(taquillaBtn(v,r,n)));row.appendChild(Object.assign(document.createElement('span'),{className:'aisle'}));row.appendChild(Object.assign(document.createElement('span'),{className:'rowLabel',textContent:r}));row.appendChild(Object.assign(document.createElement('span'),{className:'aisle'}));const mainEvens=cfg.evens.filter(n=>n<=18);const extraEvens=cfg.evens.filter(n=>n>18);mainEvens.forEach(n=>row.appendChild(taquillaBtn(v,r,n)));if(extraEvens.length){const gap=document.createElement('span');gap.className='seatGap';row.appendChild(gap);extraEvens.forEach(n=>row.appendChild(taquillaBtn(v,r,n)));}map.appendChild(row);}}
function taquillaRenderPalcos(map){const w=document.createElement('div');w.className='palcosExcel';palcoGroups.forEach(g=>{const c=document.createElement('div');c.className='palcoCol';c.innerHTML='<h3>'+g.title+'</h3>';g.nums.forEach((n,i)=>c.appendChild(taquillaBtn('palcos',g.key,n,g.title,i+1)));w.appendChild(c);});map.appendChild(w);}
function taquillaBtn(zone,row,num,labelZone=null,fila=null){const b=document.createElement('button');b.className='seat '+(zone==='preferencia'?'preferencia':zone==='palcos'?'palco':'');b.textContent=num;const coord=zone==='palcos'?`palcos-${row}-${num}`:`${zone}-${row}-${num}`;const st=taquillaStatuses.get(coord);if(st)b.classList.add(st);if(taquillaSelected.has(coord))b.classList.add('selected');b.onclick=()=>{if(st&&st!=='libre')return;if(taquillaSelected.has(coord))taquillaSelected.delete(coord);else taquillaSelected.set(coord,{coord,zone:labelZone||zones[zone].title,fila:fila||row,label:num,price:zones[zone].price});taquillaRenderMap();taquillaRenderSelected();};return b;}
function taquillaRenderSelected(){const vals=[...taquillaSelected.values()];const list=$('taquillaSelectedList');const formCard=$('taquillaFormCard');const genBtn=$('taquillaGenerateBtn');const payType=getTaquillaPayType();const isInv=payType==='invitacion';if(!vals.length){list.innerHTML='<p class="taquillaEmptyMsg">Selecciona butacas libres.</p>';formCard.style.display='none';genBtn.disabled=true;$('taquillaTotal').textContent='0 €';return;}const sub=isInv?0:vals.reduce((s,v)=>s+v.price,0);const n=vals.length;const g=isInv?0:n*GESTION_FEE;const tot=sub+g;list.innerHTML=vals.map((v,i)=>`<div class="taquillaSeatItem"><div class="seatInfo">${v.zone}<br><small>F${v.fila} · B${v.label}</small></div><span class="seatPrice">${isInv?'Invitación':v.price+' €'}</span><button class="seatRemove" onclick="taquillaRemoveSeat(${i})" title="Quitar">&times;</button></div>`).join('');if(isInv){$('taquillaTotal').textContent='Invitación';$('taquillaTotal').className='taquillaTotalValue invitacion';}else{$('taquillaTotal').innerHTML=`<span class="totalLine"><span>Entradas (${n} × ${vals[0].price}€)</span><strong>${sub.toFixed(2)} €</strong></span><span class="totalLine gestionLine"><span>Gestión (${n} × ${GESTION_FEE}€)</span><strong>${g.toFixed(2)} €</strong></span><span class="totalLine totalFinal"><span>Total</span><strong>${tot.toFixed(2)} €</strong></span>`;$('taquillaTotal').className='taquillaTotalValue';}$('taquillaAttendeeForms').innerHTML=vals.map((v,i)=>`<div class="taquillaAttendeeRow"><h4>Entrada ${i+1} <span class="seatBadge">${v.zone} · F${v.fila} · B${v.label}</span>${isInv?'<span class="invBadge">GRATIS</span>':''}</h4><label>Nombre *<input class="tqName" placeholder="Nombre"></label><label>Apellidos *<input class="tqSurname" placeholder="Apellidos"></label><label>DNI *<input class="tqDni" maxlength="9" placeholder="12345678A"></label></div>`).join('');formCard.style.display='';genBtn.disabled=false;genBtn.textContent=isInv?'🎁 Generar invitación':`💵 Generar entrada · ${tot.toFixed(2)} €`;}
function taquillaRemoveSeat(i){const k=[...taquillaSelected.keys()];if(k[i]){taquillaSelected.delete(k[i]);taquillaRenderMap();taquillaRenderSelected();}}
function taquillaClear(){taquillaSelected.clear();taquillaRenderMap();taquillaRenderSelected();}
async function taquillaGenerate(){const f=eventInfo();if(!f)return toast('Selecciona función','error');const vals=[...taquillaSelected.values()];if(!vals.length)return toast('Selecciona butacas','error');const payType=getTaquillaPayType();const isInv=payType==='invitacion';const nI=document.querySelectorAll('.tqName');const sI=document.querySelectorAll('.tqSurname');const dI=document.querySelectorAll('.tqDni');const att=[];const dnis=new Set();for(let i=0;i<vals.length;i++){const n=nI[i]?.value.trim()||'';const ap=sI[i]?.value.trim()||'';const d=dI[i]?.value.trim().toUpperCase()||'';if(!n||!ap||!d)return toast(`Faltan datos entrada ${i+1}`,'error');if(!validDni(d))return toast(`DNI incorrecto entrada ${i+1}`,'error');if(dnis.has(d))return toast(`DNI repetido: ${d}`,'error');dnis.add(d);att.push({nombre:n,apellidos:ap,dni:d,seat:vals[i]});}const ids=att.map(a=>taquillaSeatByCoord.get(a.seat.coord)?.id).filter(Boolean);if(ids.length!==att.length)return toast('Butaca no válida.','error');const{data:ex}=await sb.from('event_seats').select('estado,seat_id').eq('event_id',f.id).in('seat_id',ids);if((ex||[]).some(r=>r.estado&&r.estado!=='libre')){taquillaClear();await taquillaLoadStatuses();return toast('Butaca no disponible.','error');}const{data:exT}=await sb.from('tickets').select('seat_id').eq('event_id',f.id).in('seat_id',ids).neq('estado','cancelada');if((exT||[]).length){taquillaClear();await taquillaLoadStatuses();return toast('Butaca vendida.','error');}const now=Date.now();const num='TAQ-'+String(now).slice(-6);const sub=isInv?0:att.reduce((s,a)=>s+a.seat.price,0);const gEst=isInv?0:att.length*GESTION_FEE;const total=sub+gEst;const{data:order,error:oe}=await sb.from('orders').insert({numero_pedido:num,event_id:f.id,comprador_nombre:att[0].nombre,comprador_apellidos:att[0].apellidos,comprador_dni:att[0].dni,comprador_email:'taquilla@local',comprador_telefono:'000000000',metodo_pago:'banco',estado:'pagado',total}).select().single();if(oe)return toast('Error: '+oe.message,'error');const made=[];for(let i=0;i<att.length;i++){const a=att[i];const seat=taquillaSeatByCoord.get(a.seat.coord);const{data:t,error:te}=await sb.from('tickets').insert({numero_entrada:'ENT-'+String(now).slice(-6)+'-'+(i+1),order_id:order.id,event_id:f.id,seat_id:seat.id,nombre:a.nombre,apellidos:a.apellidos,dni:a.dni,qr_token:crypto.randomUUID(),estado:'generada'}).select('*, seats(*)').single();if(te){taquillaClear();await taquillaLoadStatuses();return toast('Error generando entrada.','error');}made.push(t);await sb.from('event_seats').upsert({event_id:f.id,seat_id:seat.id,estado:'vendida',precio:isInv?0:a.seat.price},{onConflict:'event_id,seat_id'});}taquillaClear();await taquillaLoadStatuses();await refresh();toast(isInv?'🎁 Invitación generada':'💵 Entrada generada','success');renderTicketDocuments($('ticketsList'),made,f.text,order.numero_pedido);$('ticketOverlay').classList.remove('hidden');document.body.classList.add('modalOpen');}

/* ============================================
   WIZARD – CREAR EVENTO
   ============================================ */
let parsedExcelLayout = null;

function parseExcelLayout() {
  const raw = $('wizExcelInput')?.value.trim();
  if (!raw) return toast('Pega una tabla primero.', 'error');

  let lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return toast('No se detectaron datos.', 'error');

  const rows = lines.map(line => {
    let cells;
    if (line.includes('\t')) {
      cells = line.split('\t').map(c => c.trim()).filter(c => c.length > 0);
    } else if (line.includes(';')) {
      cells = line.split(';').map(c => c.trim()).filter(c => c.length > 0);
    } else if (line.includes(',')) {
      cells = line.split(',').map(c => c.trim()).filter(c => c.length > 0);
    } else {
      cells = line.split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
    }
    return cells;
  }).filter(r => r.length > 0);

  if (rows.length === 0) return toast('No se pudieron parsear las celdas.', 'error');

  const maxCols = Math.max(...rows.map(r => r.length));
  const firstColNums = rows.every(r => /^\d+$/.test(r[0]));
  const isSequential = firstColNums && rows.length > 1 && rows.every((r, i) => parseInt(r[0]) === i + 1);
  const hasRowLabels = firstColNums && !isSequential && rows.length > 1;

  const parsedRows = rows.map(r => ({
    label: hasRowLabels ? r[0] : null,
    seats: (hasRowLabels ? r.slice(1) : r).length
  }));

  const totalRows = parsedRows.length;
  const totalSeats = parsedRows.reduce((s, r) => s + r.seats, 0);
  const avgSeats = Math.round(totalSeats / totalRows);
  const patioEnd = Math.max(1, Math.ceil(totalRows * 0.6));
  const prefEnd = Math.max(patioEnd + 1, Math.ceil(totalRows * 0.9));

  const patioRows = parsedRows.slice(0, patioEnd);
  const prefRows = parsedRows.slice(patioEnd, prefEnd);
  const palcoRows = parsedRows.slice(prefEnd);

  const patioSeats = patioRows.reduce((s, r) => s + r.seats, 0);
  const prefSeats = prefRows.reduce((s, r) => s + r.seats, 0);
  const palcoSeats = palcoRows.reduce((s, r) => s + r.seats, 0);

  parsedExcelLayout = {
    totalRows, totalSeats, avgSeats,
    patioEnd, prefEnd,
    patioRows: patioEnd, prefRows: prefEnd - patioEnd, palcoRows: totalRows - prefEnd,
    patioSeats, prefSeats, palcoSeats
  };

  const preview = $('wizExcelPreview');
  if (preview) {
    preview.style.display = 'block';
    preview.innerHTML = `
      <div class="excelPreviewGrid">
        <div class="excelPreviewStat"><span>Filas detectadas</span><strong>${totalRows}</strong></div>
        <div class="excelPreviewStat"><span>Columnas máx</span><strong>${maxCols}</strong></div>
        <div class="excelPreviewStat"><span>Butacas totales</span><strong>${totalSeats}</strong></div>
        <div class="excelPreviewStat"><span>Promedio/fila</span><strong>${avgSeats}</strong></div>
      </div>
      <div class="excelPreviewZones">
        <div class="excelZoneItem patio">💺 Patio: filas 1–${patioEnd} (${patioSeats} butacas)</div>
        <div class="excelZoneItem preferencia">⭐ Preferencia: filas ${patioEnd + 1}–${prefEnd} (${prefSeats} butacas)</div>
        <div class="excelZoneItem palcos">🎪 Palcos: filas ${prefEnd + 1}–${totalRows} (${palcoSeats} butacas)</div>
      </div>`;
  }

  const zoneSel = $('wizExcelZones');
  if (zoneSel) {
    zoneSel.style.display = 'block';
    const ranges = $('wizExcelZoneRanges');
    if (ranges) {
      ranges.innerHTML = `
        <div class="excelZoneRange">
          <label>💺 Patio termina en fila:</label>
          <input id="wizExcelPatioEnd" type="number" min="1" max="${totalRows}" value="${patioEnd}">
        </div>
        <div class="excelZoneRange">
          <label>⭐ Preferencia termina en fila:</label>
          <input id="wizExcelPrefEnd" type="number" min="1" max="${totalRows}" value="${prefEnd}">
        </div>
        ${totalRows === 1 ? '<div class="excelZoneRange" style="grid-column:1/-1"><small style="color:#64748b">ℹ️ Solo 1 fila detectada: se asignará toda a Patio. Edita los rangos si necesitas cambiarlo.</small></div>' : ''}`;
    }
  }

  toast(`Detectadas ${totalRows} filas, ${totalSeats} butacas.`, 'success');
}

function applyExcelLayout() {
  if (!parsedExcelLayout) return toast('Primero detecta el layout.', 'error');
  const patioEnd = +($('wizExcelPatioEnd')?.value || parsedExcelLayout.patioEnd);
  const prefEnd = +($('wizExcelPrefEnd')?.value || parsedExcelLayout.prefEnd);
  const totalRows = parsedExcelLayout.totalRows;
  const avgSeats = parsedExcelLayout.avgSeats;
  const halfSeats = Math.ceil(avgSeats / 2);

  const patioRows = Math.max(0, patioEnd);
  const prefRows = Math.max(0, prefEnd - patioEnd);
  const palcoRows = Math.max(0, totalRows - prefEnd);

  if ($('wizPatioFilas')) $('wizPatioFilas').value = patioRows;
  if ($('wizPatioButIzq')) $('wizPatioButIzq').value = halfSeats;
  if ($('wizPatioButDer')) $('wizPatioButDer').value = halfSeats;
  if ($('wizPrefFilas')) $('wizPrefFilas').value = prefRows;
  if ($('wizPrefButIzq')) $('wizPrefButIzq').value = halfSeats;
  if ($('wizPrefButDer')) $('wizPrefButDer').value = halfSeats;
  if ($('wizPalcosAltoImpar')) $('wizPalcosAltoImpar').value = Math.ceil(palcoRows * 4 * 0.5);
  if ($('wizPalcosAltoPar')) $('wizPalcosAltoPar').value = Math.ceil(palcoRows * 4 * 0.5);
  if ($('wizPalcosBajoImpar')) $('wizPalcosBajoImpar').value = Math.floor(palcoRows * 4 * 0.5);
  if ($('wizPalcosBajoPar')) $('wizPalcosBajoPar').value = Math.floor(palcoRows * 4 * 0.5);

  wizardUpdatePreviews();
  toast('Layout aplicado al formulario.', 'success');
}

function clearExcelImport() {
  if ($('wizExcelInput')) $('wizExcelInput').value = '';
  if ($('wizExcelPreview')) { $('wizExcelPreview').style.display = 'none'; $('wizExcelPreview').innerHTML = ''; }
  if ($('wizExcelZones')) { $('wizExcelZones').style.display = 'none'; }
  parsedExcelLayout = null;
}
function bindWizardInputs() {
  ['wizPatioFilas','wizPatioButIzq','wizPatioButDer','wizPrefFilas','wizPrefButIzq','wizPrefButDer',
   'wizPalcosAltoImpar','wizPalcosAltoPar','wizPalcosBajoImpar','wizPalcosBajoPar',
   'wizPatioPrecio','wizPrefPrecio','wizPalcosPrecio','wizGestionFee'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', wizardUpdatePreviews);
  });
}

function wizardUpdatePreviews() {
  const pFilas=+($('wizPatioFilas')?.value||0), pIzq=+($('wizPatioButIzq')?.value||0), pDer=+($('wizPatioButDer')?.value||0);
  const fFilas=+($('wizPrefFilas')?.value||0), fIzq=+($('wizPrefButIzq')?.value||0), fDer=+($('wizPrefButDer')?.value||0);
  const palAI=+($('wizPalcosAltoImpar')?.value||0), palAP=+($('wizPalcosAltoPar')?.value||0);
  const palBI=+($('wizPalcosBajoImpar')?.value||0), palBP=+($('wizPalcosBajoPar')?.value||0);
  const pTotal=numSeats(pFilas,pIzq,pDer), fTotal=numSeats(fFilas,fIzq,fDer), palTotal=palAI+palAP+palBI+palBP;
  const pPrecio=+($('wizPatioPrecio')?.value||0), fPrecio=+($('wizPrefPrecio')?.value||0), palPrecio=+($('wizPalcosPrecio')?.value||0);
  const gestFee=+($('wizGestionFee')?.value||GESTION_FEE);
  const allTickets=pTotal+fTotal+palTotal;
  if($('wizPatioPreview'))$('wizPatioPreview').innerHTML=`<small style="color:#64748b">${pFilas} filas × ${pIzq}+${pDer} butacas = <strong>${pTotal} butacas</strong></small>`;
  if($('wizPrefPreview'))$('wizPrefPreview').innerHTML=`<small style="color:#64748b">${fFilas} filas × ${fIzq}+${fDer} butacas = <strong>${fTotal} butacas</strong></small>`;
  if($('wizPalcosPreview'))$('wizPalcosPreview').innerHTML=`<small style="color:#64748b">Alto: ${palAI}+${palAP} | Bajo: ${palBI}+${palBP} = <strong>${palTotal} palcos</strong></small>`;
  if($('wizPatioSeats'))$('wizPatioSeats').textContent=pTotal+' butacas';
  if($('wizPrefSeats'))$('wizPrefSeats').textContent=fTotal+' butacas';
  if($('wizPalcosSeats'))$('wizPalcosSeats').textContent=palTotal+' butacas';
  if($('wizPatioTotal'))$('wizPatioTotal').textContent=(pTotal*pPrecio).toFixed(2)+' €';
  if($('wizPrefTotal'))$('wizPrefTotal').textContent=(fTotal*fPrecio).toFixed(2)+' €';
  if($('wizPalcosTotal'))$('wizPalcosTotal').textContent=(palTotal*palPrecio).toFixed(2)+' €';
  if($('wizPatioCount'))$('wizPatioCount').textContent=pTotal;
  if($('wizPrefCount'))$('wizPrefCount').textContent=fTotal;
  if($('wizPalcosCount'))$('wizPalcosCount').textContent=palTotal;
  if($('wizGestionTotal'))$('wizGestionTotal').textContent=(allTickets*gestFee).toFixed(2)+' €';
}

function wizardGo(step) {
  document.querySelectorAll('.wizPanel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.wizStep').forEach(s => { s.classList.remove('active','done'); });
  document.querySelectorAll('.wizStep').forEach(s => { const sn=+s.dataset.step; if(sn<step)s.classList.add('done'); if(sn===step)s.classList.add('active'); });
  const panel=$('wizStep'+step);
  if(panel)panel.classList.add('active');
  wizardStep=step;
  if(step===4)wizardRenderSummary();
}
function wizardNext(){if(wizardStep===1&&!($('wizNombre')?.value.trim()&&$('wizFecha')?.value&&$('wizHora')?.value))return toast('Rellena nombre, fecha y hora.','error');wizardGo(wizardStep+1);}
function wizardPrev(){if(wizardStep>1)wizardGo(wizardStep-1);}

function wizardRenderSummary(){
  const n=$('wizNombre')?.value.trim()||'Sin nombre';
  const f=$('wizFecha')?.value||'—';
  const h=$('wizHora')?.value||'—';
  const est=$('wizEstado')?.value||'activo';
  const desc=$('wizDescripcion')?.value.trim()||'';
  const pFilas=+($('wizPatioFilas')?.value||0), pIzq=+($('wizPatioButIzq')?.value||0), pDer=+($('wizPatioButDer')?.value||0);
  const fFilas=+($('wizPrefFilas')?.value||0), fIzq=+($('wizPrefButIzq')?.value||0), fDer=+($('wizPrefButDer')?.value||0);
  const palAI=+($('wizPalcosAltoImpar')?.value||0), palAP=+($('wizPalcosAltoPar')?.value||0);
  const palBI=+($('wizPalcosBajoImpar')?.value||0), palBP=+($('wizPalcosBajoPar')?.value||0);
  const pTotal=numSeats(pFilas,pIzq,pDer), fTotal=numSeats(fFilas,fIzq,fDer), palTotal=palAI+palAP+palBI+palBP;
  const allT=pTotal+fTotal+palTotal;
  const pPrec=+($('wizPatioPrecio')?.value||0), fPrec=+($('wizPrefPrecio')?.value||0), palPrec=+($('wizPalcosPrecio')?.value||0);
  const gestF=+($('wizGestionFee')?.value||GESTION_FEE);
  const revP=pTotal*pPrec, revF=fTotal*fPrec, revPal=palTotal*palPrec;
  const totalRev=revP+revF+revPal;
  const totalGest=allT*gestF;
  const estLabel=est==='activo'?'🟢 Activo':est==='oculto'?'🟡 Oculto':'🔴 Cerrado';
  $('wizSummary').innerHTML=`
    <div class="wizSummaryGrid">
      <div class="wizSummarySection"><h4>📋 Datos del evento</h4>
        <div class="wizSummaryRow"><span>Nombre</span><strong>${n}</strong></div>
        <div class="wizSummaryRow"><span>Fecha</span><strong>${f}</strong></div>
        <div class="wizSummaryRow"><span>Hora</span><strong>${h}</strong></div>
        <div class="wizSummaryRow"><span>Estado</span><strong>${estLabel}</strong></div>
        ${desc?`<div class="wizSummaryRow"><span>Descripción</span><strong>${desc}</strong></div>`:''}
      </div>
      <div class="wizSummarySection"><h4>💺 Layout del teatro</h4>
        <div class="wizSummaryRow"><span>💺 Patio</span><strong>${pFilas} filas × ${pIzq}+${pDer} = ${pTotal} butacas</strong></div>
        <div class="wizSummaryRow"><span>⭐ Preferencia</span><strong>${fFilas} filas × ${fIzq}+${fDer} = ${fTotal} butacas</strong></div>
        <div class="wizSummaryRow"><span>🎪 Palcos</span><strong>${palTotal} palcos (${palAI}+${palAP}+${palBI}+${palBP})</strong></div>
        <div class="wizSummaryRow total"><span>Total butacas</span><strong>${allT}</strong></div>
      </div>
      <div class="wizSummarySection"><h4>💰 Precios</h4>
        <div class="wizSummaryRow"><span>💺 Patio</span><strong>${pPrec} € × ${pTotal} = ${revP.toFixed(2)} €</strong></div>
        <div class="wizSummaryRow"><span>⭐ Preferencia</span><strong>${fPrec} € × ${fTotal} = ${revF.toFixed(2)} €</strong></div>
        <div class="wizSummaryRow"><span>🎪 Palcos</span><strong>${palPrec} € × ${palTotal} = ${revPal.toFixed(2)} €</strong></div>
        <div class="wizSummaryRow total"><span>Recaudación max</span><strong>${totalRev.toFixed(2)} €</strong></div>
      </div>
      <div class="wizSummarySection"><h4>💶 Gestión</h4>
        <div class="wizSummaryRow"><span>Gestión/entrada</span><strong>${gestF.toFixed(2)} €</strong></div>
        <div class="wizSummaryRow"><span>Total gestión</span><strong>${totalGest.toFixed(2)} €</strong></div>
        <div class="wizSummaryRow total"><span>Cobro total posible</span><strong>${(totalRev+totalGest).toFixed(2)} €</strong></div>
      </div>
    </div>`;
}

async function wizardCreate(){
  const n=$('wizNombre')?.value.trim(), f=$('wizFecha')?.value, h=$('wizHora')?.value, est=$('wizEstado')?.value;
  if(!n||!f||!h)return toast('Faltan datos básicos.','error');
  const desc=$('wizDescripcion')?.value.trim()||'';
  let layout;
  if (parsedExcelLayout) {
    const patioEnd=+($('wizExcelPatioEnd')?.value||parsedExcelLayout.patioEnd);
    const prefEnd=+($('wizExcelPrefEnd')?.value||parsedExcelLayout.prefEnd);
    layout={
      patio:{filas:patioEnd,butIzq:+($('wizPatioButIzq')?.value||11),butDer:+($('wizPatioButDer')?.value||11),precio:+($('wizPatioPrecio')?.value||0)},
      preferencia:{filas:prefEnd-patioEnd,butIzq:+($('wizPrefButIzq')?.value||9),butDer:+($('wizPrefButDer')?.value||9),precio:+($('wizPrefPrecio')?.value||0)},
      palcos:{altoImpar:+($('wizPalcosAltoImpar')?.value||0),altoPar:+($('wizPalcosAltoPar')?.value||0),bajoImpar:+($('wizPalcosBajoImpar')?.value||0),bajoPar:+($('wizPalcosBajoPar')?.value||0),precio:+($('wizPalcosPrecio')?.value||0)},
      gestion_fee:+($('wizGestionFee')?.value||GESTION_FEE),
      excel_imported:true
    };
  } else {
    layout={
      patio:{filas:+($('wizPatioFilas')?.value||0),butIzq:+($('wizPatioButIzq')?.value||0),butDer:+($('wizPatioButDer')?.value||0),precio:+($('wizPatioPrecio')?.value||0)},
      preferencia:{filas:+($('wizPrefFilas')?.value||0),butIzq:+($('wizPrefButIzq')?.value||0),butDer:+($('wizPrefButDer')?.value||0),precio:+($('wizPrefPrecio')?.value||0)},
      palcos:{altoImpar:+($('wizPalcosAltoImpar')?.value||0),altoPar:+($('wizPalcosAltoPar')?.value||0),bajoImpar:+($('wizPalcosBajoImpar')?.value||0),bajoPar:+($('wizPalcosBajoPar')?.value||0),precio:+($('wizPalcosPrecio')?.value||0)},
      gestion_fee:+($('wizGestionFee')?.value||GESTION_FEE)
    };
  }
  const{error}=await sb.from('events').insert({nombre:n,fecha:f,hora:h,estado:est,descripcion:desc,layout_config:layout});
  if(error)return toast('Error: '+error.message,'error');
  toast('Función creada correctamente','success');
  $('wizNombre').value='';$('wizFecha').value='';$('wizHora').value='';$('wizDescripcion').value='';
  parsedExcelLayout=null;clearExcelImport();
  wizardGo(1);
  await loadEvents();refresh();
}

/* ============================================
   LOGIN
   ============================================ */
async function login() {
  const email = $('adminEmail').value.trim();
  const password = $('adminPassword').value;
  const errorDiv = $('loginError');

  errorDiv.classList.add('hidden');

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errorDiv.textContent = 'Credenciales incorrectas';
    errorDiv.classList.remove('hidden');
    return;
  }

  const { data: p } = await sb.from('profiles')
    .select('rol')
    .eq('id', data.user.id)
    .single();

  if (!p || !['superadmin', 'taquilla'].includes(p.rol)) {
    errorDiv.textContent = 'Usuario sin permisos';
    errorDiv.classList.remove('hidden');
    return;
  }

  $('loginOverlay').classList.add('hidden');
  showAdmin();
}

async function showAdmin() {
  try { bind(); } catch(e) { console.error('Bind error:', e); }
  try { await loadEvents(); } catch(e) { console.error('LoadEvents error:', e); }
  try { await loadValidadosEvents(); } catch(e) { console.error('LoadValidadosEvents error:', e); }
  try { await refresh(); } catch(e) { console.error('Refresh error:', e); }
  try { await taquillaLoadSeats(); } catch(e) { console.error('TaquillaSeats error:', e); }
  try { wizardUpdatePreviews(); } catch(e) {}
  try { bindWizardInputs(); } catch(e) {}
  const excelInput = $('wizExcelInput');
  if (excelInput) {
    excelInput.addEventListener('paste', () => { setTimeout(parseExcelLayout, 100); });
  }
}



init();
