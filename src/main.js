import * as XLSX from 'xlsx';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  getSupabaseProjectRef,
  hasSupabaseConfig,
  pingSupabase,
  supabase,
  supabaseUrl,
} from './lib/supabase';
import './styles.css';

window.XLSX = XLSX;

let potreros = [];
let rotacion = [];
let rodeoColors = {};
let map = null;
let mapaEl = null;
let potrerosLayer = null;
let labelsLayer = null;
let activityLayer = null;
let routeLayer = null;
let animRAF = null;
let animando = false;
let animMs = null;
let animStartMs = 0;
let animEndMs = 0;
let animSpeed = 5;
let hoverIdx = null;
let hoverPrIdx = null;
let curFecha = new Date();

const RCOLS = ['#c0392b', '#7d3c98', '#1a6fa8', '#d46b18', '#0d7360', '#616a13'];
const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTR = '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const LABELS_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

window.addEventListener('load', () => {
  mapaEl = document.getElementById('mapa');
  initMap();
  window.addEventListener('resize', () => map?.invalidateSize());
  setHoy();
  refreshSupabaseStatus();
});

function initMap() {
  map = L.map('mapview', {
    zoomControl: true,
    preferCanvas: true,
  }).setView([-34.6, -58.4], 14);

  L.tileLayer(SATELLITE_URL, {
    maxZoom: 20,
    attribution: SATELLITE_ATTR,
  }).addTo(map);

  L.tileLayer(LABELS_URL, {
    maxZoom: 20,
    opacity: 0.85,
    attribution: SATELLITE_ATTR,
    pane: 'overlayPane',
  }).addTo(map);

  potrerosLayer = L.layerGroup().addTo(map);
  labelsLayer = L.layerGroup().addTo(map);
  activityLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

function setS(id, type, msg) {
  const el = document.getElementById(id);
  el.className = `sbar ${type}`;
  const dc = { idle: 'idle', loading: 'loading', ok: 'ok', err: 'err' }[type];
  el.innerHTML = `<div class="sdot ${dc}"></div><span>${msg}</span>`;
}

async function refreshSupabaseStatus() {
  const metaEl = document.getElementById('supmeta');
  const helpEl = document.getElementById('suphelp');

  if (metaEl) {
    metaEl.textContent = hasSupabaseConfig
      ? `${getSupabaseProjectRef()} · ${supabaseUrl}`
      : 'Faltan variables VITE_SUPABASE_*';
  }

  if (!hasSupabaseConfig) {
    setS('ssupabase', 'err', 'Falta configurar la URL o la publishable key');
    if (helpEl) helpEl.textContent = 'Completá .env.local y reiniciá Vite para empezar a usar Supabase.';
    return;
  }

  setS('ssupabase', 'loading', 'Probando conexión con Supabase...');

  try {
    const settings = await pingSupabase();
    const providers = Object.entries(settings?.external || {})
      .filter(([, cfg]) => cfg)
      .map(([name]) => name);

    setS('ssupabase', 'ok', '✓ Supabase conectado');
    if (helpEl) {
      helpEl.textContent = providers.length
        ? `Proyecto listo. Auth responde y ya podés sumar tablas, storage o login. Proveedores detectados: ${providers.join(', ')}.`
        : 'Proyecto listo. Auth responde y ya podés sumar tablas, storage o login cuando armes la base.';
    }
  } catch (err) {
    setS('ssupabase', 'err', `No pude conectar: ${err.message}`);
    if (helpEl) helpEl.textContent = 'La configuración quedó cargada, pero la API no respondió. Revisá la publishable key o la conexión.';
  }
}

function loadKML(input) {
  const f = input.files[0];
  if (!f) return;
  setS('skml', 'loading', `Leyendo ${f.name}...`);

  const r = new FileReader();
  r.onload = (e) => {
    try {
      const doc = new DOMParser().parseFromString(e.target.result, 'text/xml');
      potreros = [];

      doc.querySelectorAll('Placemark').forEach((pm) => {
        let nombre = '';
        const nn = pm.querySelectorAll('name');
        if (nn.length) nombre = nn[0].textContent.trim();

        pm.querySelectorAll('Data').forEach((d) => {
          if (d.getAttribute('name') === 'name') {
            const v = d.querySelector('value');
            if (v) nombre = v.textContent.trim();
          }
        });

        if (!nombre) return;

        let area = null;
        pm.querySelectorAll('Data').forEach((d) => {
          if (d.getAttribute('name') === 'area') {
            const v = d.querySelector('value');
            if (v) area = parseFloat(v.textContent);
          }
        });

        let best = [];
        pm.querySelectorAll('coordinates').forEach((ce) => {
          const c = ce.textContent
            .trim()
            .split(/\s+/)
            .map((x) => {
              const p = x.split(',');
              return { lng: parseFloat(p[0]), lat: parseFloat(p[1]) };
            })
            .filter((c0) => !isNaN(c0.lng) && !isNaN(c0.lat));
          if (c.length > best.length) best = c;
        });

        if (best.length < 3) return;

        const cx = best.reduce((s, c) => s + c.lng, 0) / best.length;
        const cy = best.reduce((s, c) => s + c.lat, 0) / best.length;

        potreros.push({
          nombre,
          coords: best,
          latlngs: best.map((c) => [c.lat, c.lng]),
          area,
          centroide: { lng: cx, lat: cy },
          layer: null,
          labelMarker: null,
        });
      });

      if (!potreros.length) {
        setS('skml', 'err', 'No se encontraron potreros');
        return;
      }

      setS('skml', 'ok', `✓ ${potreros.length} potreros georreferenciados`);
      document.getElementById('empty').style.display = 'none';
      buildMapLayers();
      renderMap(curFecha);
      checkAnim();
    } catch (err) {
      setS('skml', 'err', `Error: ${err.message}`);
    }
  };

  r.readAsText(f);
}

function buildMapLayers() {
  potrerosLayer.clearLayers();
  labelsLayer.clearLayers();
  activityLayer.clearLayers();
  routeLayer.clearLayers();

  const bounds = [];

  potreros.forEach((p, i) => {
    const layer = L.polygon(p.latlngs, {
      color: 'rgba(255,255,255,.38)',
      weight: 1.5,
      fillColor: '#3a5030',
      fillOpacity: 0.42,
    });

    layer.on('mouseover', (ev) => {
      hoverIdx = i;
      renderMap(curFecha);
      showTip(ev.originalEvent, p, curFecha);
    });

    layer.on('mousemove', (ev) => {
      showTip(ev.originalEvent, p, curFecha);
    });

    layer.on('mouseout', () => {
      hoverIdx = null;
      hideTip();
      if (!animando) renderMap(curFecha);
    });

    layer.on('click', () => {
      map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 19 });
    });

    layer.addTo(potrerosLayer);
    p.layer = layer;

    const labelGeom = getLotLabelGeometry(p);
    const labelMarker = L.marker([labelGeom.lat, labelGeom.lng], {
      icon: lotLabelIcon(shortLotName(p.nombre), false, labelGeom.angle),
      interactive: false,
      keyboard: false,
    }).addTo(labelsLayer);

    p.labelMarker = labelMarker;
    bounds.push(...p.latlngs);
  });

  if (bounds.length) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
  }
}

function loadExcel(input) {
  const f = input.files[0];
  if (!f) return;
  setS('sxl', 'loading', `Leyendo ${f.name}...`);

  const r = new FileReader();
  r.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      rotacion = [];
      const rSet = new Set();
      let metodo = '';

      const pastSheets = wb.SheetNames.filter((s) => s.toLowerCase().includes('pastor'));

      pastSheets.forEach((sn) => {
        const ws = wb.Sheets[sn];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        let rodeo = sn;
        for (let r0 = 0; r0 < Math.min(6, data.length); r0 += 1) {
          if (!data[r0]) continue;
          for (const v of data[r0]) {
            if (typeof v === 'string' && v.length > 2 && !v.includes('=') && !v.includes('http') && !v.includes('PLANILLA')) {
              const vl = v.toLowerCase();
              if (
                vl.includes('rodeo') || vl.includes('vaca') || vl.includes('madre') || vl.includes('toro') ||
                vl.includes('novillo') || vl.includes('ternero') || vl.includes('vaquillona') || vl.includes('célula')
              ) {
                rodeo = v.trim();
              }
            }
          }
        }

        let cL = -1;
        let cFE = -1;
        let cFS = -1;
        let cD = -1;
        let cSup = -1;

        for (let r0 = 0; r0 < data.length; r0 += 1) {
          const row = data[r0];
          if (!row) continue;

          const vals = row.map((v) => String(v ?? '').toLowerCase().trim());
          if (vals.includes('lote') && (vals.some((v) => v.includes('fecha ent')) || vals.some((v) => v === 'fecha ent'))) {
            cL = vals.indexOf('lote');
            cFE = vals.findIndex((v) => v.includes('fecha ent'));
            cFS = vals.findIndex((v) => v.includes('fecha sal'));
            cD = vals.findIndex((v) => v === 'días' || v === 'dias');
            cSup = vals.findIndex((v) => v.includes('supl'));
            continue;
          }

          if (cL === -1) continue;

          const lv = row[cL];
          if (lv === null || lv === undefined || typeof lv === 'boolean') continue;
          if (typeof lv === 'string' && (lv.includes('PLANIFICADO') || lv.includes('REAL') || lv.toLowerCase().includes('lote'))) continue;

          const loteStr = String(lv).trim();
          if (!loteStr || loteStr === 'null') continue;

          const feR = row[cFE];
          const fsR = row[cFS];
          if (!feR || !fsR) continue;

          const fEnt = feR instanceof Date ? feR : xlDate(feR);
          const fSal = fsR instanceof Date ? fsR : xlDate(fsR);
          if (!fEnt || !fSal || isNaN(fEnt.getTime())) continue;
          if (fEnt.getFullYear() > 2050 || fSal.getFullYear() > 2050) continue;

          const dias = cD >= 0 && row[cD] ? Math.round(Number(row[cD])) : null;
          const supl = cSup >= 0 ? row[cSup] : null;
          const lotNum = parseFloat(loteStr);

          rSet.add(rodeo);
          rotacion.push({
            rodeo,
            lote: loteStr,
            lotNum: isNaN(lotNum) ? null : lotNum,
            fechaEntrada: fEnt,
            fechaSalida: fSal,
            dias,
            supl: supl ? String(supl) : '',
            orden: rotacion.length,
          });
          metodo = 'Planilla del Pastor';
        }
      });

      if (rotacion.length === 0) {
        const tSh = wb.SheetNames.find((s) => s.includes('Tablero') && !s.includes('OFFLINE'));
        if (tSh) {
          const ws = wb.Sheets[tSh];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
          let hRow = -1;

          for (let r0 = 0; r0 < Math.min(30, data.length); r0 += 1) {
            if (data[r0] && String(data[r0][0] ?? '').toLowerCase().includes('nombre lote')) {
              hRow = r0;
              break;
            }
          }

          if (hRow !== -1) {
            for (let r0 = hRow + 1; r0 < data.length; r0 += 1) {
              const row = data[r0];
              if (!row) continue;
              const lote = row[0];
              const rodeo = row[2] ?? 'Rodeo';
              if (!lote || typeof lote !== 'string') continue;
              const loteStr = lote.trim();

              [[11, 13], [14, 16]].forEach(([ei, si]) => {
                const fe = row[ei];
                const fs = row[si];
                const e0 = fe instanceof Date ? fe : xlDate(fe);
                const s0 = fs instanceof Date ? fs : xlDate(fs);
                if (e0 && s0 && e0.getFullYear() < 2050 && s0.getFullYear() < 2050) {
                  rSet.add(String(rodeo).trim());
                  rotacion.push({
                    rodeo: String(rodeo).trim(),
                    lote: loteStr,
                    lotNum: null,
                    fechaEntrada: e0,
                    fechaSalida: s0,
                    dias: Math.round((s0 - e0) / 86400000),
                    supl: '',
                    orden: rotacion.length,
                  });
                }
              });
            }
            metodo = '5. Tablero';
          }
        }
      }

      if (rotacion.length === 0) {
        setS('sxl', 'err', 'No encontré datos. Verificá que el archivo tenga "Planilla del Pastor" o "5. Tablero"');
        return;
      }

      rotacion.sort((a, b) => a.fechaEntrada - b.fechaEntrada);

      const rArr = [...rSet];
      rArr.forEach((r0, i) => {
        rodeoColors[r0] = RCOLS[i % RCOLS.length];
      });

      animStartMs = Math.min(...rotacion.map((r0) => r0.fechaEntrada.getTime()));
      animEndMs = Math.max(...rotacion.map((r0) => r0.fechaSalida.getTime()));
      animMs = animStartMs;
      document.getElementById('tls').textContent = fmtC(new Date(animStartMs));
      document.getElementById('tle').textContent = fmtC(new Date(animEndMs));
      document.getElementById('tlblk').style.display = 'block';

      document.getElementById('rlist').innerHTML = rArr
        .map((r0) => `<div class="rchip"><div class="rdot" style="background:${rodeoColors[r0]}"></div>${r0}</div>`)
        .join('');

      const nLotes = new Set(rotacion.map((r0) => r0.lote)).size;
      setS('sxl', 'ok', `✓ ${nLotes} lotes · ${rotacion.length} movimientos · ${rArr.length} rodeo${rArr.length > 1 ? 's' : ''} (${metodo})`);

      buildPanelPastor();
      if (potreros.length) renderMap(curFecha);
      checkAnim();
    } catch (err) {
      setS('sxl', 'err', `Error: ${err.message}`);
      console.error(err);
    }
  };

  r.readAsArrayBuffer(f);
}

function xlDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.floor(v - 25569) * 86400000);
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  return null;
}

function checkAnim() {
  document.getElementById('abtn').disabled = !(potreros.length && rotacion.length);
}

function buildPanelPastor() {
  const body = document.getElementById('prbody');
  document.querySelector('.pr-sub').textContent = `${rotacion.length} movimientos`;
  body.innerHTML = '';

  rotacion.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'pr-row';
    div.dataset.idx = i;
    div.innerHTML = `
      <div class="pr-num">${i + 1}</div>
      <div class="pr-info">
        <div class="pr-lote">${nomPotrero(m)}</div>
        <div class="pr-dates">${fmtC(m.fechaEntrada)} → ${fmtC(m.fechaSalida)}</div>
        ${m.supl ? `<div class="pr-dias">${m.supl}</div>` : ''}
      </div>
      <div>
        <div class="pr-badge pb-sin" id="pbadge-${i}">—</div>
        <div class="pr-dias" id="pdias-${i}">${m.dias ? `${m.dias}d` : ''}</div>
      </div>`;

    div.addEventListener('mouseenter', () => {
      hoverPrIdx = i;
      updatePanelHighlight();
      if (!animando) renderMap(curFecha);
    });

    div.addEventListener('mouseleave', () => {
      hoverPrIdx = null;
      updatePanelHighlight();
      if (!animando) renderMap(curFecha);
    });

    body.appendChild(div);
  });

  updatePanelBadges(curFecha);
}

function updatePanelBadges(fecha) {
  rotacion.forEach((m, i) => {
    const pbEl = document.getElementById(`pbadge-${i}`);
    const pdEl = document.getElementById(`pdias-${i}`);
    const row = document.querySelector(`.pr-row[data-idx="${i}"]`);
    if (!pbEl || !row) return;

    const fc = new Date(fecha);
    fc.setHours(12);
    const fE = new Date(m.fechaEntrada);
    fE.setHours(0);
    const fS = new Date(m.fechaSalida);
    fS.setHours(23, 59, 59);
    row.className = 'pr-row';

    if (fc >= fE && fc <= fS) {
      row.classList.add('oc');
      pbEl.className = 'pr-badge pb-oc';
      pbEl.textContent = 'Ocupado';
      const diasR = Math.ceil((fS - fc) / 86400000);
      pdEl.textContent = `Sale en ${diasR}d`;
    } else if (fc < fE) {
      row.classList.add('pro');
      pbEl.className = 'pr-badge pb-pro';
      pbEl.textContent = 'Próximo';
      pdEl.textContent = `Entra en ${Math.ceil((fE - fc) / 86400000)}d`;
    } else {
      row.classList.add('des');
      pbEl.className = 'pr-badge pb-des';
      pbEl.textContent = 'Pasado';
      pdEl.textContent = `Hace ${Math.floor((fc - fS) / 86400000)}d`;
    }
  });
}

function updatePanelHighlight() {
  document.querySelectorAll('.pr-row').forEach((r, i) => {
    r.classList.toggle('hl', i === hoverPrIdx);
  });
}

function nomPotrero(m) {
  if (m.lotNum !== null) {
    const p = potreros.find((p0) => matchLote(p0.nombre, m));
    if (p) return p.nombre;
    return `Potrero ${m.lote}`;
  }
  return m.lote;
}

function nm(s) {
  return String(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

function nmn(s) {
  return String(s).toLowerCase().trim().replace(/potrero\s*/g, '').replace(/lote\s*/g, '').replace(/\s+/g, '');
}

function matchLote(potNombre, mov) {
  if (nm(potNombre) === nm(mov.lote)) return true;
  const pn = nmn(potNombre);
  const mn = nmn(mov.lote);
  if (pn === mn) return true;
  if (mov.lotNum !== null) {
    const numStr = String(mov.lotNum);
    if (pn === numStr) return true;
    if (pn.startsWith(numStr) && pn.length > numStr.length && isNaN(pn[numStr.length])) return true;
  }
  return false;
}

function getEst(p, fecha) {
  const fc = new Date(fecha);
  fc.setHours(12);

  for (const m of rotacion) {
    if (!matchLote(p.nombre, m)) continue;
    const fE = new Date(m.fechaEntrada);
    fE.setHours(0);
    const fS = new Date(m.fechaSalida);
    fS.setHours(23, 59, 59);
    if (fc >= fE && fc <= fS) {
      return {
        tipo: 'ocupado',
        rodeo: m.rodeo,
        fEnt: m.fechaEntrada,
        fSal: m.fechaSalida,
        diasRest: Math.ceil((fS - fc) / 86400000),
        mov: m,
      };
    }
  }

  let proxMov = null;
  for (const m of rotacion) {
    if (!matchLote(p.nombre, m)) continue;
    const fE = new Date(m.fechaEntrada);
    fE.setHours(0);
    if (fE > fc && (!proxMov || fE < new Date(proxMov.fechaEntrada))) proxMov = m;
  }

  let ultSal = null;
  for (const m of rotacion) {
    if (!matchLote(p.nombre, m)) continue;
    const fS = new Date(m.fechaSalida);
    if (fS < fc && (!ultSal || fS > ultSal)) ultSal = fS;
  }

  if (ultSal || proxMov) {
    return { tipo: 'descanso', diasDesc: ultSal ? Math.floor((fc - ultSal) / 86400000) : null, prox: proxMov };
  }

  return { tipo: 'sin' };
}

function getProximoGlobal(fecha) {
  const fc = new Date(fecha);
  fc.setHours(12);
  let mejor = null;
  for (const m of rotacion) {
    const fE = new Date(m.fechaEntrada);
    fE.setHours(0);
    if (fE > fc && (!mejor || fE < new Date(mejor.fechaEntrada))) mejor = m;
  }
  return mejor;
}

function getMovimientoActual(fecha) {
  const fc = new Date(fecha);
  fc.setHours(12);
  return rotacion.find((m) => {
    const fE = new Date(m.fechaEntrada);
    const fS = new Date(m.fechaSalida);
    fE.setHours(0);
    fS.setHours(23, 59, 59);
    return fc >= fE && fc <= fS;
  }) ?? null;
}

function renderMap(fecha) {
  if (!potreros.length || !map) return;

  curFecha = fecha;
  const proxGlobal = getProximoGlobal(fecha);
  let nOc = 0;
  let nDes = 0;
  let nPro = 0;

  activityLayer.clearLayers();
  routeLayer.clearLayers();

  potreros.forEach((p, i) => {
    const est = getEst(p, fecha);
    const isHovered = hoverIdx === i || (hoverPrIdx !== null && rotacion[hoverPrIdx] && matchLote(p.nombre, rotacion[hoverPrIdx]));
    const isProx = est.tipo === 'descanso' && proxGlobal && matchLote(p.nombre, proxGlobal);
    const fillColor = est.tipo === 'ocupado'
      ? (rodeoColors[est.rodeo] || '#c0392b')
      : (isProx ? '#d46b18' : (est.tipo === 'descanso' ? '#3a7a33' : '#3a5030'));

    p.layer.setStyle({
      color: isHovered ? 'rgba(160,255,130,.9)' : 'rgba(255,255,255,.46)',
      weight: isHovered ? 3 : 1.5,
      fillColor,
      fillOpacity: isHovered ? 0.58 : 0.42,
    });

    if (isHovered) p.layer.bringToFront();

    const labelGeom = getLotLabelGeometry(p);
    p.labelMarker.setLatLng([labelGeom.lat, labelGeom.lng]);
    p.labelMarker.setIcon(lotLabelIcon(shortLotName(p.nombre), isHovered, labelGeom.angle));

    if (est.tipo === 'ocupado') {
      nOc += 1;
      addAnimalBadge(p, est);
    } else if (est.tipo === 'descanso') {
      nDes += 1;
    }

    if (isProx) nPro += 1;
  });

  drawMovimiento(fecha, proxGlobal);

  document.getElementById('noc').textContent = nOc;
  document.getElementById('ndes').textContent = nDes;
  document.getElementById('npro').textContent = nPro;
  document.getElementById('ntot').textContent = potreros.length;
  document.getElementById('bsts').style.display = 'flex';
  document.getElementById('fbadge').style.display = 'block';
  document.getElementById('fbf').textContent = fmtF(fecha);
  document.getElementById('fbd').textContent = fmtD(fecha);
  updatePanelBadges(fecha);
}

function addAnimalBadge(p, est) {
  const marker = L.marker([p.centroide.lat, p.centroide.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="animal-badge" style="border-color:${rodeoColors[est.rodeo] || '#c0392b'}66;color:${rodeoColors[est.rodeo] || '#c0392b'}">🐄 ${est.rodeo}</div>`,
      iconSize: [90, 24],
      iconAnchor: [45, -8],
    }),
    interactive: false,
    keyboard: false,
  });

  marker.addTo(activityLayer);
}

function drawMovimiento(fecha, proxGlobal) {
  if (!proxGlobal) return;

  const actual = getMovimientoActual(fecha);
  if (!actual) return;

  const origen = potreros.find((p) => matchLote(p.nombre, actual));
  const destino = potreros.find((p) => matchLote(p.nombre, proxGlobal));
  if (!origen || !destino || origen === destino) return;

  L.polyline(
    [
      [origen.centroide.lat, origen.centroide.lng],
      [destino.centroide.lat, destino.centroide.lng],
    ],
    {
      color: '#ffd483',
      weight: 2.5,
      opacity: 0.75,
      dashArray: '8 7',
    },
  ).addTo(routeLayer);

  const diasHasta = Math.ceil((new Date(proxGlobal.fechaEntrada) - new Date(fecha)) / 86400000);
  const lat = (origen.centroide.lat + destino.centroide.lat) / 2;
  const lng = (origen.centroide.lng + destino.centroide.lng) / 2;

  L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="route-badge">→ ${shortLotName(destino.nombre)} en ${diasHasta}d</div>`,
      iconSize: [150, 24],
      iconAnchor: [75, 12],
    }),
    interactive: false,
    keyboard: false,
  }).addTo(routeLayer);
}

function lotLabelIcon(text, highlighted = false, angle = 0) {
  const wrapped = wrapLotLabel(text);
  const isSmall = wrapped.includes('<br>');
  return L.divIcon({
    className: '',
    html: `<div class="lot-label ${highlighted ? 'hl' : ''} ${isSmall ? 'small' : ''}" style="transform: rotate(${angle}deg)">${wrapped}</div>`,
    iconSize: [104, isSmall ? 36 : 26],
    iconAnchor: [0, 0],
  });
}

function shortLotName(nombre) {
  return nombre.replace(/[Pp]otrero\s*/g, 'P').replace(/[Ll]ote\s*/g, 'L');
}

function wrapLotLabel(text) {
  const clean = String(text).trim();
  if (clean.length <= 11) return clean;

  const parts = clean.split(/\s+/);
  if (parts.length === 1) {
    return `${clean.slice(0, 11)}<br>${clean.slice(11, 22)}`;
  }

  let first = '';
  let second = '';
  for (const part of parts) {
    if (`${first} ${part}`.trim().length <= 11) {
      first = `${first} ${part}`.trim();
    } else {
      second = `${second} ${part}`.trim();
    }
  }

  if (!second) {
    return `${clean.slice(0, 11)}<br>${clean.slice(11, 22)}`;
  }

  return `${first}<br>${second}`;
}

function getLotLabelGeometry(p) {
  const centroid = L.latLng(p.centroide.lat, p.centroide.lng);
  const bounds = p.layer ? p.layer.getBounds() : L.latLngBounds(p.latlngs);
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  const latSpan = Math.max(north - south, 0.00008);
  const lngSpan = Math.max(east - west, 0.00008);

  let best = p.latlngs[0];
  let bestScore = -Infinity;

  for (const [lat, lng] of p.latlngs) {
    const northness = (lat - south) / latSpan;
    const westness = (east - lng) / lngSpan;
    const score = northness + westness;
    if (score > bestScore) {
      bestScore = score;
      best = [lat, lng];
    }
  }

  const insetLat = best[0] + (centroid.lat - best[0]) * 0.18;
  const insetLng = best[1] + (centroid.lng - best[1]) * 0.18;

  const topEdge = getTopEdge(p.latlngs, best);
  const angle = topEdge ? getScreenAngle(topEdge[0], topEdge[1]) : 0;

  return {
    lat: insetLat,
    lng: insetLng,
    angle,
  };
}

function getTopEdge(latlngs, anchor) {
  if (!latlngs.length) return null;

  let anchorIndex = latlngs.findIndex(([lat, lng]) => lat === anchor[0] && lng === anchor[1]);
  if (anchorIndex === -1) anchorIndex = 0;

  const prev = latlngs[(anchorIndex - 1 + latlngs.length) % latlngs.length];
  const next = latlngs[(anchorIndex + 1) % latlngs.length];
  const candidates = [
    [anchor, prev],
    [anchor, next],
  ];

  candidates.sort((a, b) => {
    const aAvgLat = (a[0][0] + a[1][0]) / 2;
    const bAvgLat = (b[0][0] + b[1][0]) / 2;
    return bAvgLat - aAvgLat;
  });

  return candidates[0];
}

function getScreenAngle(a, b) {
  if (!map) return 0;

  const pa = map.latLngToLayerPoint([a[0], a[1]]);
  const pb = map.latLngToLayerPoint([b[0], b[1]]);
  let angle = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;

  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;

  return angle;
}

function showTip(e, p, fecha) {
  const tip = document.getElementById('tip');
  const wr = mapaEl.getBoundingClientRect();
  const est = getEst(p, fecha);
  const fc = new Date(fecha);
  fc.setHours(12);
  const proxGlobal = getProximoGlobal(fecha);
  const esPro = est.tipo === 'descanso' && proxGlobal && matchLote(p.nombre, proxGlobal);

  let h = `<div class="tt">${p.nombre}</div>`;
  if (p.area) h += `<div class="tr"><span class="trl">Superficie</span><span class="trv">${p.area.toFixed(1)} ha</span></div>`;

  if (est.tipo === 'ocupado') {
    h += `<div class="tr"><span class="trl">Rodeo</span><span class="trv">${est.rodeo}</span></div>`;
    h += `<div class="tr"><span class="trl">Ingresó</span><span class="trv">${fmtF(est.fEnt)}</span></div>`;
    h += `<div class="tr"><span class="trl">Sale</span><span class="trv">${fmtF(est.fSal)}</span></div>`;
    h += `<div class="tr"><span class="trl">Días restantes</span><span class="trv">${est.diasRest} días</span></div>`;
    if (est.mov?.supl) h += `<div class="tr"><span class="trl">Suplemento</span><span class="trv">${est.mov.supl}</span></div>`;
    h += '<span class="tbg toc">🐄 Con animales</span>';
  } else if (esPro) {
    const dias = Math.ceil((new Date(proxGlobal.fechaEntrada) - fc) / 86400000);
    h += `<div class="tr"><span class="trl">Próximo ingreso</span><span class="trv">${fmtF(proxGlobal.fechaEntrada)}</span></div>`;
    h += `<div class="tr"><span class="trl">Faltan</span><span class="trv">${dias} días</span></div>`;
    h += `<div class="tr"><span class="trl">Sale el</span><span class="trv">${fmtF(proxGlobal.fechaSalida)}</span></div>`;
    if (proxGlobal.dias) h += `<div class="tr"><span class="trl">Estadía</span><span class="trv">${proxGlobal.dias} días</span></div>`;
    h += '<span class="tbg tpro">⏳ Próximo ingreso</span>';
  } else if (est.tipo === 'descanso') {
    h += `<div class="tr"><span class="trl">Días descansando</span><span class="trv">${est.diasDesc ?? '—'} días</span></div>`;
    if (est.prox) {
      const dias = Math.ceil((new Date(est.prox.fechaEntrada) - fc) / 86400000);
      h += `<div class="tr"><span class="trl">Próx. entrada</span><span class="trv">${fmtF(est.prox.fechaEntrada)}</span></div>`;
      h += `<div class="tr"><span class="trl">Faltan</span><span class="trv">${dias} días</span></div>`;
    }
    h += '<span class="tbg tdes">🌿 En descanso</span>';
  } else {
    h += '<span class="tbg tsin">Sin datos en planilla</span>';
  }

  tip.innerHTML = h;
  tip.classList.add('vis');

  let tx = e.clientX - wr.left + 14;
  let ty = e.clientY - wr.top + 14;
  if (tx + 260 > wr.width) tx = e.clientX - wr.left - 265;
  if (ty + 240 > wr.height) ty = e.clientY - wr.top - 240;
  tip.style.left = `${tx}px`;
  tip.style.top = `${ty}px`;
}

function hideTip() {
  document.getElementById('tip').classList.remove('vis');
}

function toggleAnim() {
  if (animando) stopAnim();
  else startAnim();
}

function startAnim() {
  if (!rotacion.length || !potreros.length) return;
  animando = true;
  document.getElementById('abtn').classList.add('on');
  document.getElementById('aico').textContent = '■';
  document.getElementById('albl').textContent = 'Detener simulación';
  document.getElementById('asts').classList.add('vis');
  if (!animMs || animMs >= animEndMs - 86400000) animMs = animStartMs;

  let last = null;
  function loop(ts) {
    if (!animando) return;
    if (!last) last = ts;
    animMs += ((ts - last) / 1000) * animSpeed * 2.5 * 86400000;
    last = ts;

    if (animMs >= animEndMs) {
      animMs = animEndMs;
      const f = new Date(animMs);
      document.getElementById('datePick').value = isoD(f);
      renderMap(f);
      updAnim(1, f);
      stopAnim();
      return;
    }

    const f = new Date(animMs);
    document.getElementById('datePick').value = isoD(f);
    updAnim((animMs - animStartMs) / (animEndMs - animStartMs), f);
    renderMap(f);
    animRAF = requestAnimationFrame(loop);
  }

  animRAF = requestAnimationFrame(loop);
}

function stopAnim() {
  animando = false;
  if (animRAF) {
    cancelAnimationFrame(animRAF);
    animRAF = null;
  }
  document.getElementById('abtn').classList.remove('on');
  document.getElementById('aico').textContent = '▶';
  document.getElementById('albl').textContent = 'Simular rotación';
  document.getElementById('asts').classList.remove('vis');
}

function updAnim(prog, f) {
  document.getElementById('asfi').style.width = `${(prog * 100).toFixed(1)}%`;
  document.getElementById('asl').textContent = `SIMULANDO · ${fmtF(f)}`;
  document.getElementById('tlfi').style.width = `${(prog * 100).toFixed(1)}%`;
}

function setSp(v) {
  animSpeed = parseInt(v, 10);
  document.getElementById('spv').textContent = `${v}×`;
}

function onDateChange() {
  const v = document.getElementById('datePick').value;
  if (!v) return;
  const [y, m, d] = v.split('-').map(Number);
  curFecha = new Date(y, m - 1, d, 12);
  if (potreros.length) renderMap(curFecha);
}

function setHoy() {
  const h = new Date();
  document.getElementById('datePick').value = isoD(h);
  curFecha = new Date(h.getFullYear(), h.getMonth(), h.getDate(), 12);
  if (potreros.length) renderMap(curFecha);
}

function isoD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtF(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtC(d) {
  return new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function fmtD(d) {
  return new Date(d).toLocaleDateString('es-AR', { weekday: 'long' });
}

Object.assign(window, {
  loadKML,
  loadExcel,
  onDateChange,
  retrySupabaseConnection: refreshSupabaseStatus,
  setHoy,
  toggleAnim,
  setSp,
  supabase,
});
