'use strict';

/* ================= Configuración ================= */
const TYPES = {
  restaurante: { label: 'Restaurante', plural: 'Restaurantes', d: 'M7 3v8M4 3v4a3 3 0 0 0 6 0V3M7 11v10M17 3c-2.5 2-2.5 8 0 10v8' },
  lugar:       { label: 'Lugar',       plural: 'Lugares',      d: 'M6 21V4l12 5-12 5' },
  bar:         { label: 'Bar / café',  plural: 'Bares y cafés', d: 'M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2' },
  alojamiento: { label: 'Alojamiento', plural: 'Alojamientos', d: 'M3 19V6M3 15h18v4M21 15v-2a3 3 0 0 0-3-3h-7v5' },
};
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ICON = {
  back: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B2421" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  edit: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B2421" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};

/* ================= Utilidades ================= */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const typeOf = (p) => TYPES[p.type] || TYPES.lugar;
const urls = new WeakMap();
const urlFor = (blob) => { if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob)); return urls.get(blob); };
const bg = (blob) => (blob ? `style="background-image:url('${urlFor(blob)}')"` : '');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}
function typeSvg(type, color = 'currentColor', size = 24) {
  const t = TYPES[type] || TYPES.lugar;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${t.d}"/></svg>`;
}
function statusHtml(p) {
  const v = p.status === 'visited';
  return `<span class="status ${v ? 'v' : 'w'}"><span class="dot ${v ? 'v' : 'w'}"></span>${v ? 'Visitado' : 'Quiero ir'} · ${esc(typeOf(p).label)}</span>`;
}
function goBack(fallback) {
  if (history.length > 1) history.back(); else location.hash = fallback;
}

/* ================= Base de datos (IndexedDB, en el móvil) ================= */
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('mapa-viajes', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('places', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('places', mode);
    const req = fn(t.objectStore('places'));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
  });
}
const getAll = () => tx('readonly', (s) => s.getAll());
const putPlace = (p) => tx('readwrite', (s) => s.put(p));
const delPlace = (id) => tx('readwrite', (s) => s.delete(id));

/* ================= Estado ================= */
const state = {
  places: [],
  mapFilter: 'all',
  query: '',
  listStatus: 'visited',
  listType: 'all',
  fitted: false,
  focus: null,   // id a centrar al volver al mapa
  newAt: null,   // latlng de una pulsación larga en el mapa
};
async function reload() {
  state.places = (await getAll()).sort((a, b) => (b.created || 0) - (a.created || 0));
}

/* ================= Mapa principal ================= */
let map, layer, meMarker;

function pinIcon(p) {
  const v = p.status === 'visited';
  const html = `<svg width="36" height="45" viewBox="0 0 40 50"><path d="M20 48C20 48 3 30 3 19a17 17 0 0 1 34 0c0 11-17 29-17 29z" fill="${v ? '#0E6B61' : '#fff'}" stroke="${v ? '#fff' : '#D9622B'}" stroke-width="3"/><g transform="translate(10 9) scale(.84)"><path d="${typeOf(p).d}" fill="none" stroke="${v ? '#fff' : '#B8481A'}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  return L.divIcon({ html, className: 'pin', iconSize: [36, 45], iconAnchor: [18, 44] });
}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([41.39, 2.17], 5);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(map);
  layer = L.layerGroup().addTo(map);
  map.on('click', hidePreview);
  // Pulsación larga (o clic derecho) → nuevo lugar en ese punto
  map.on('contextmenu', (e) => { state.newAt = e.latlng; location.hash = '#/nuevo'; });
  map.on('locationfound', (e) => {
    if (meMarker) meMarker.setLatLng(e.latlng);
    else meMarker = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#2F6FDB', fillOpacity: 1 }).addTo(map);
  });
  map.on('locationerror', () => toast('No he podido obtener tu ubicación'));
}

function matchQuery(p, q) {
  if (!q) return true;
  return [p.name, p.city, p.note, (p.tags || []).join(' ')].join(' ').toLowerCase().includes(q.toLowerCase());
}
function mapPlaces() {
  const f = state.mapFilter;
  return state.places.filter((p) => (f === 'all' || p.status === f || p.type === f) && matchQuery(p, state.query));
}
function fitTo(ps) {
  if (!ps.length) return;
  if (ps.length === 1) map.setView([ps[0].lat, ps[0].lng], 15);
  else map.fitBounds(L.latLngBounds(ps.map((p) => [p.lat, p.lng])), { padding: [70, 70], maxZoom: 15 });
}
function renderMap() {
  layer.clearLayers();
  const ps = mapPlaces();
  ps.forEach((p) => {
    L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name, alt: p.name })
      .on('click', () => showPreview(p))
      .addTo(layer);
  });
  $('#map-hint').hidden = state.places.length > 0;

  if (state.focus) {
    const p = state.places.find((x) => x.id === state.focus);
    state.focus = null;
    if (p) { map.setView([p.lat, p.lng], 16); showPreview(p); return; }
  }
  if (!state.fitted && ps.length) { state.fitted = true; fitTo(ps); }
}
function showPreview(p) {
  const el = $('#preview');
  const ph = p.photos && p.photos[0];
  el.href = '#/lugar/' + p.id;
  el.innerHTML = `
    <div class="thumb" ${bg(ph)}>${ph ? '' : typeSvg(p.type, '#56625D', 28)}</div>
    <div class="meta">${statusHtml(p)}
      <div class="pname">${esc(p.name)}</div>
      <div class="ell">${esc(p.note || p.city || '')}</div>
    </div>`;
  el.hidden = false;
  $('#v-mapa').classList.add('has-preview');
}
function hidePreview() {
  $('#preview').hidden = true;
  $('#v-mapa').classList.remove('has-preview');
}

/* ================= Lista ================= */
function renderList() {
  const nV = state.places.filter((p) => p.status === 'visited').length;
  const nW = state.places.length - nV;
  const s = state.listStatus;
  $('#seg').innerHTML = `
    <button role="tab" data-s="visited" class="${s === 'visited' ? 'on' : ''}" aria-selected="${s === 'visited'}">Visitados · ${nV}</button>
    <button role="tab" data-s="want" class="${s === 'want' ? 'on' : ''}" aria-selected="${s === 'want'}">Quiero ir · ${nW}</button>`;

  const chips = [['all', 'Todo'], ...Object.entries(TYPES).map(([k, t]) => [k, t.plural]), ['photos', 'Con fotos']];
  $('#list-chips').innerHTML = chips.map(([k, l]) => `<button class="chip ${state.listType === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('');

  const ps = state.places
    .filter((p) => p.status === s)
    .filter((p) => state.listType === 'all' || (state.listType === 'photos' ? (p.photos || []).length : p.type === state.listType));

  if (!ps.length) {
    $('#list').innerHTML = `<p class="empty">${state.places.length
      ? 'Nada por aquí con este filtro.'
      : 'Aún no has guardado ningún lugar.<br>Pulsa <b>+</b> para añadir el primero.'}</p>`;
    return;
  }
  const groups = {};
  ps.forEach((p) => { const c = p.city || 'Sin ciudad'; (groups[c] = groups[c] || []).push(p); });
  const cities = Object.keys(groups).sort((a, b) => (a === 'Sin ciudad') - (b === 'Sin ciudad') || a.localeCompare(b, 'es'));
  $('#list').innerHTML = cities.map((c) => `
    <section class="group">
      <div class="group-h"><h2>${esc(c)}</h2><span class="muted" style="font-size:13px">${groups[c].length} ${groups[c].length === 1 ? 'lugar' : 'lugares'}</span></div>
      ${groups[c].map(rowHtml).join('')}
    </section>`).join('');
}
function rowHtml(p) {
  const ph = p.photos && p.photos[0];
  const n = (p.photos || []).length;
  const sub = [typeOf(p).label, p.rating ? '★'.repeat(p.rating) : '', n > 1 ? n + ' fotos' : ''].filter(Boolean).join(' · ');
  return `<a class="row" href="#/lugar/${p.id}">
    <div class="thumb" ${bg(ph)}>${ph ? '' : typeSvg(p.type, '#56625D')}</div>
    <div class="meta"><b>${esc(p.name)}</b><span class="ell">${esc(sub)}</span>${p.note ? `<span class="ell">${esc(p.note)}</span>` : ''}</div>
  </a>`;
}

/* ================= Ficha ================= */
function renderFicha(id) {
  const el = $('#v-lugar');
  const p = state.places.find((x) => x.id === id);
  el.dataset.id = id || '';
  if (!p) {
    el.innerHTML = '<p class="empty">Este lugar no existe.</p><p style="text-align:center"><a class="btn" href="#/lugares">Ver mis lugares</a></p>';
    return;
  }
  const v = p.status === 'visited';
  const photos = (p.photos || []).length
    ? p.photos.map((b) => `<img src="${urlFor(b)}" alt="">`).join('')
    : `<div class="noimg">${typeSvg(p.type, '#56625D', 44)}</div>`;
  const date = p.date ? new Date(p.date + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const stars = p.rating ? `${'★'.repeat(p.rating)}<span style="color:#C9CFC6">${'★'.repeat(5 - p.rating)}</span>` : '';
  const hasNote = p.note || (p.tags || []).length;

  el.innerHTML = `
    <button class="round" style="left:16px" data-act="back" aria-label="Volver">${ICON.back}</button>
    <a class="round" style="right:16px" href="#/editar/${p.id}" aria-label="Editar">${ICON.edit}</a>
    <div class="hero">${photos}</div>
    <div class="ficha-body">
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="badge ${v ? 'v' : 'w'}"><span class="dot ${v ? 'v' : 'w'}"></span>${v ? 'Visitado' : 'Quiero ir'}</span>
          <span class="muted" style="font-size:13px">${esc([typeOf(p).label, p.city].filter(Boolean).join(' · '))}</span>
        </div>
        <h1 style="margin:0;font-size:28px">${esc(p.name)}</h1>
        ${stars || date ? `<div style="font-size:15px">${stars} <span class="muted">${date ? (stars ? '· ' : '') + date : ''}</span></div>` : ''}
      </div>
      ${hasNote ? `<div class="card"><div class="label">Mi nota</div>
        ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
        ${(p.tags || []).length ? `<div class="tags">${p.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="btns">
        <a class="btn dark" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">Cómo llegar</a>
        <button class="btn" data-act="show">Ver en el mapa</button>
        ${v ? '' : '<button class="btn primary" data-act="visited">Ya he ido</button>'}
      </div>
      <button class="btn danger" data-act="delete" style="align-self:flex-start;margin-top:12px">Borrar lugar</button>
    </div>`;
}

async function onFichaAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = $('#v-lugar').dataset.id;
  const p = state.places.find((x) => x.id === id);
  switch (b.dataset.act) {
    case 'back': goBack('#/mapa'); break;
    case 'show': state.focus = id; state.mapFilter = 'all'; syncMapChips(); location.hash = '#/mapa'; break;
    case 'visited':
      p.status = 'visited'; p.date = p.date || today(); p.updated = Date.now();
      await putPlace(p); await reload(); renderFicha(id); toast('¡Marcado como visitado!');
      break;
    case 'delete':
      if (confirm(`¿Borrar «${p.name}»? No se puede deshacer.`)) {
        await delPlace(id); await reload();
        location.replace('#/lugares'); toast('Lugar borrado');
      }
      break;
  }
}

/* ================= Formulario (nuevo / editar) ================= */
let pick;
let form = {};

function initPick() {
  pick = L.map('pickmap', { zoomControl: false }).setView([41.39, 2.17], 5);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(pick);
  pick.on('locationerror', () => toast('No he podido obtener tu ubicación'));
}

function openForm(id) {
  const p = id ? state.places.find((x) => x.id === id) : null;
  if (id && !p) { location.replace('#/lugares'); return; }
  form = {
    id: p ? p.id : null,
    created: p ? p.created : null,
    status: p ? p.status : 'visited',
    type: p ? p.type : 'restaurante',
    rating: p ? p.rating || 0 : 0,
    photos: p ? [...(p.photos || [])] : [],
  };
  $('#form-title').textContent = p ? 'Editar lugar' : 'Nuevo lugar';
  $('#f-name').value = p ? p.name : '';
  $('#f-city').value = p ? p.city || '' : '';
  $('#f-date').value = p ? p.date || '' : today();
  $('#f-note').value = p ? p.note || '' : '';
  $('#f-tags').value = p ? (p.tags || []).join(', ') : '';
  $('#addr').value = '';
  renderOpts();
  renderPhotos();

  setTimeout(() => {
    pick.invalidateSize();
    if (p) pick.setView([p.lat, p.lng], 16);
    else if (state.newAt) { pick.setView(state.newAt, Math.max(map.getZoom(), 16)); state.newAt = null; }
    else pick.setView(map.getCenter(), Math.max(map.getZoom(), 13));
  }, 60);
}

function renderOpts() {
  $('#f-status').innerHTML = [['visited', 'Ya fui', 'v'], ['want', 'Quiero ir', 'w']].map(([k, l, c]) =>
    `<button type="button" class="opt ${c} ${form.status === k ? 'on' : ''}" data-status="${k}" aria-pressed="${form.status === k}"><span class="dot ${c}"></span>${l}</button>`).join('');
  $('#f-type').innerHTML = Object.entries(TYPES).map(([k, t]) =>
    `<button type="button" class="chip ${form.type === k ? 'on' : ''}" data-type="${k}" aria-pressed="${form.type === k}">${typeSvg(k, 'currentColor', 16)}${t.label}</button>`).join('');
  $('#f-stars').innerHTML = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" data-rating="${n}" class="${n <= form.rating ? 'on' : ''}" aria-label="${n} ${n === 1 ? 'estrella' : 'estrellas'}">★</button>`).join('');
}

function renderPhotos() {
  $('#f-photos').innerHTML =
    form.photos.map((b, i) => `<div class="ph" ${bg(b)}><button type="button" data-rm="${i}" aria-label="Quitar foto">✕</button></div>`).join('') +
    `<label class="add-ph">+ Fotos<input type="file" id="f-files" accept="image/*" multiple hidden></label>`;
}

// Reduce las fotos (máx. 1600 px, JPEG) para que no ocupen demasiado en el móvil
function compress(file, max = 1600, quality = 0.82) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(u);
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la foto'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Formato de imagen no soportado')); };
    img.src = u;
  });
}

// Búsqueda de direcciones gratuita con Nominatim (OpenStreetMap)
async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=es&q=' + encodeURIComponent(q));
  const j = await r.json();
  return j[0];
}
async function cityAt(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=es&lat=${lat}&lon=${lng}`);
    const a = (await r.json()).address || {};
    return a.city || a.town || a.village || a.municipality || a.county || '';
  } catch { return ''; }
}
async function searchAddress() {
  const q = $('#addr').value.trim();
  if (!q) return;
  try {
    const r = await geocode(q);
    if (!r) { toast('No lo encuentro, prueba con otra dirección'); return; }
    pick.setView([+r.lat, +r.lon], 17);
    if (!$('#f-name').value && r.name) $('#f-name').value = r.name;
  } catch { toast('Necesitas conexión para buscar'); }
}

async function saveForm(e) {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  if (!name) { $('#f-name').focus(); toast('Ponle un nombre'); return; }
  const btn = $('#f-save');
  btn.disabled = true;
  const c = pick.getCenter();
  let city = $('#f-city').value.trim();
  if (!city) city = await cityAt(c.lat, c.lng);

  const p = {
    id: form.id || uid(),
    name,
    status: form.status,
    type: form.type,
    city,
    lat: +c.lat.toFixed(6),
    lng: +c.lng.toFixed(6),
    rating: form.rating,
    date: $('#f-date').value,
    note: $('#f-note').value.trim(),
    tags: $('#f-tags').value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    photos: form.photos,
    created: form.created || Date.now(),
    updated: Date.now(),
  };
  try {
    await putPlace(p);
  } catch (err) {
    toast('No se ha podido guardar: ' + err.message);
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  await reload();
  // Pide al navegador que no borre los datos si falta espacio
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  location.replace('#/lugar/' + p.id);
  toast('Guardado');
}

/* ================= Fotos ================= */
function renderGallery() {
  const items = state.places.flatMap((p) => (p.photos || []).map((b) => ({ b, p })));
  $('#gallery').innerHTML = items.length
    ? items.map(({ b, p }) => `<a href="#/lugar/${p.id}" ${bg(b)} aria-label="${esc(p.name)}"></a>`).join('')
    : '<p class="empty" style="grid-column:1/-1">Las fotos que añadas a tus lugares aparecerán aquí.</p>';
}

/* ================= Copia de seguridad ================= */
async function renderMas() {
  const n = state.places.length;
  const np = state.places.reduce((s, p) => s + (p.photos || []).length, 0);
  let usage = '';
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    usage = ` Ocupa unos ${(e.usage / 1048576).toFixed(1)} MB.`;
  }
  $('#mas-info').innerHTML = `<p><b>${n}</b> ${n === 1 ? 'lugar' : 'lugares'} · <b>${np}</b> fotos.${usage}</p>`;
}

const blobToDataURL = (b) => new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
const dataURLToBlob = async (u) => (await fetch(u)).blob();

async function exportData() {
  toast('Preparando la copia…');
  const out = { app: 'mapa-viajes', version: 1, exported: new Date().toISOString(), places: [] };
  for (const p of state.places) {
    out.places.push({ ...p, photos: await Promise.all((p.photos || []).map(blobToDataURL)) });
  }
  const file = new File([JSON.stringify(out)], `mapa-viajes-${today()}.json`, { type: 'application/json' });
  // En el móvil, abre el menú de compartir (Drive, iCloud, WhatsApp…)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Mapa de viajes' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importData(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!Array.isArray(j.places)) throw new Error('formato');
    let n = 0;
    for (const p of j.places) {
      if (!p.id || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      const photos = (p.photos || []).filter((u) => typeof u === 'string' && u.startsWith('data:image/'));
      p.photos = await Promise.all(photos.map(dataURLToBlob));
      await putPlace(p);
      n++;
    }
    await reload();
    state.fitted = false;
    toast(`${n} ${n === 1 ? 'lugar importado' : 'lugares importados'}`);
    renderMas();
  } catch {
    toast('Ese archivo no es una copia válida');
  }
}

/* ================= Navegación ================= */
const VIEWS = { mapa: 'v-mapa', lugares: 'v-lugares', lugar: 'v-lugar', nuevo: 'v-form', editar: 'v-form', fotos: 'v-fotos', mas: 'v-mas' };

function route() {
  const [, view = 'mapa', id] = (location.hash || '#/mapa').split('/');
  const sec = VIEWS[view] || 'v-mapa';
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === sec));
  document.body.classList.toggle('no-tab', sec === 'v-lugar' || sec === 'v-form');
  document.querySelectorAll('#tabbar .tab').forEach((t) => t.classList.toggle('on', t.dataset.v === view));

  if (sec === 'v-mapa') { hidePreview(); requestAnimationFrame(() => { map.invalidateSize(); renderMap(); }); }
  else if (sec === 'v-lugares') renderList();
  else if (sec === 'v-lugar') { renderFicha(id); $('#v-lugar').scrollTop = 0; }
  else if (sec === 'v-form') { openForm(view === 'editar' ? id : null); $('#v-form').scrollTop = 0; }
  else if (sec === 'v-fotos') renderGallery();
  else if (sec === 'v-mas') renderMas();
}

function syncMapChips() {
  document.querySelectorAll('#map-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.f === state.mapFilter));
}

function bind() {
  // Mapa
  $('#map-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.mapFilter = b.dataset.f;
    syncMapChips(); hidePreview(); renderMap();
  });
  let qTimer;
  $('#q').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    hidePreview(); renderMap();
    clearTimeout(qTimer);
    if (state.query) qTimer = setTimeout(() => fitTo(mapPlaces()), 500);
  });
  $('#locate').addEventListener('click', () => map.locate({ setView: true, maxZoom: 16 }));

  // Lista
  $('#seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b) { state.listStatus = b.dataset.s; renderList(); }
  });
  $('#list-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (b) { state.listType = b.dataset.t; renderList(); }
  });

  // Ficha
  $('#v-lugar').addEventListener('click', onFichaAction);

  // Formulario
  $('#form').addEventListener('submit', saveForm);
  $('#f-cancel').addEventListener('click', () => goBack('#/mapa'));
  $('#addr-go').addEventListener('click', searchAddress);
  $('#addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } });
  $('#pick-locate').addEventListener('click', () => pick.locate({ setView: true, maxZoom: 17 }));
  $('#form').addEventListener('click', (e) => {
    const s = e.target.closest('[data-status]');
    const t = e.target.closest('[data-type]');
    const r = e.target.closest('[data-rating]');
    const rm = e.target.closest('[data-rm]');
    if (s) {
      form.status = s.dataset.status;
      if (form.status === 'visited' && !$('#f-date').value) $('#f-date').value = today();
      renderOpts();
    }
    if (t) { form.type = t.dataset.type; renderOpts(); }
    if (r) { const n = +r.dataset.rating; form.rating = form.rating === n ? 0 : n; renderOpts(); }
    if (rm) { form.photos.splice(+rm.dataset.rm, 1); renderPhotos(); }
  });
  $('#f-photos').addEventListener('change', async (e) => {
    if (e.target.id !== 'f-files') return;
    const files = [...e.target.files];
    if (!files.length) return;
    toast(files.length > 1 ? `Procesando ${files.length} fotos…` : 'Procesando foto…');
    for (const f of files) {
      try { form.photos.push(await compress(f)); }
      catch (err) { toast(err.message); }
    }
    renderPhotos();
  });

  // Copia
  $('#export').addEventListener('click', exportData);
  $('#import').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  window.addEventListener('hashchange', route);
}

/* ================= Arranque ================= */
(async function start() {
  initMap();
  initPick();
  bind();
  try { await reload(); }
  catch { toast('Este navegador no permite guardar datos (¿modo incógnito?)'); }
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
