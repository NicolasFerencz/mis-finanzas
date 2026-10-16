/* Mis finanzas: dashboard estático que lee data/finanzas.json (generado por scripts/build_data.py). */
'use strict';

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const N_SLOTS = 7; // categorías con color propio; el resto se agrupa en "Resto"

const st = {
  datos: null, moneda: 'uyu', desde: null, hasta: null, modo: 'mes', ventana: 3,
  tab: 'resumen', escala: 'propia', catSel: null, verNeutros: false,
  detMes: null, detBuscar: '', detNeutros: false, detAbiertas: new Set(),
  revNivel: 0, revMes: '*', revBuscar: '', revHechos: false, revLimite: 60, local: false,
};
const charts = {};

// ---------- utilidades
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const nombreMes = (m, largo) => {
  const [a, mm] = m.split('-');
  const n = MESES_ES[+mm - 1];
  return largo ? `${n} ${a}` : `${n} ${a.slice(2)}`;
};
const fmt = (v, opt = {}) => {
  const usd = st.moneda === 'usd';
  const abs = Math.abs(v);
  const dec = usd && abs < 1000 ? 0 : 0;
  const s = new Intl.NumberFormat('es-UY', { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(abs);
  return `${v < 0 ? '−' : opt.signo && v > 0 ? '+' : ''}${usd ? 'US$ ' : '$ '}${s}`;
};
const fmtCorto = (v) => {
  const usd = st.moneda === 'usd';
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? (abs / 1e6).toFixed(1).replace('.', ',') + ' M' : abs >= 1e3 ? Math.round(abs / 1e3) + ' k' : Math.round(abs);
  return `${v < 0 ? '−' : ''}${usd ? 'US$' : '$'}${s}`;
};
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const monto = (x) => x[st.moneda];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

function mesesRango() {
  return st.datos.meses.filter((m) => m >= st.desde && m <= st.hasta);
}

// Suma por clave → mes, sobre TODOS los meses (la media móvil usa meses previos al rango).
function sumarPor(tipo, clave = 'categoria') {
  const out = {};
  for (const x of st.datos.movimientos) {
    if (x.tipo !== tipo) continue;
    const k = x[clave];
    (out[k] ||= {})[x.mes] = (out[k][x.mes] || 0) + monto(x);
  }
  return out;
}

// Aplica el modo de vista a una serie mensual {mes: valor} y devuelve un array alineado a `meses`.
function transformar(serie, meses) {
  const todos = st.datos.meses;
  const v = (m) => serie[m] || 0;
  if (st.modo === 'promedio') {
    const prom = meses.reduce((a, m) => a + v(m), 0) / (meses.length || 1);
    return meses.map(() => prom);
  }
  if (st.modo === 'movil') {
    return meses.map((m) => {
      const i = todos.indexOf(m);
      const ventana = todos.slice(Math.max(0, i - st.ventana + 1), i + 1);
      return ventana.reduce((a, mm) => a + v(mm), 0) / ventana.length;
    });
  }
  return meses.map(v);
}

// Orden fijo de categorías por gasto total de todo el período: el color sigue a la categoría, no al filtro.
function categoriasConColor() {
  const tot = {};
  for (const x of st.datos.movimientos) if (x.tipo === 'egreso') tot[x.categoria] = (tot[x.categoria] || 0) + x.uyu;
  const orden = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  const conColor = orden.slice(0, N_SLOTS);
  const color = {};
  conColor.forEach((c, i) => { color[c] = `--s${i + 1}`; });
  return { conColor, color, orden };
}

// ---------- Chart.js: estilo común
function estiloChart() {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--grid');
  const tt = Chart.defaults.plugins.tooltip;
  Object.assign(tt, {
    backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: css('--ink-2'),
    borderColor: css('--border'), borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
    usePointStyle: true,
  });
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = 'rectRounded';
  Chart.defaults.plugins.legend.labels.color = css('--ink-2');
}

function nuevoChart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
  return charts[id];
}

const ejeY = (extra = {}) => ({
  grid: { color: css('--grid'), drawTicks: false },
  border: { display: false },
  ticks: { callback: (v) => fmtCorto(v), padding: 8, maxTicksLimit: 6 },
  ...extra,
});
const ejeX = (extra = {}) => ({ grid: { display: false }, border: { color: css('--axis') }, ...extra });

// ---------- RESUMEN
function renderResumen() {
  const meses = mesesRango();
  const egr = sumarPor('egreso');
  const ing = sumarPor('ingreso');
  const { conColor, color, orden } = categoriasConColor();
  const n = meses.length || 1;

  // Totales del rango
  const totCat = {};
  for (const c of orden) totCat[c] = meses.reduce((a, m) => a + (egr[c]?.[m] || 0), 0);
  const totEgr = Object.values(totCat).reduce((a, b) => a + b, 0);
  const totIngFuente = {};
  for (const f of Object.keys(ing)) totIngFuente[f] = meses.reduce((a, m) => a + (ing[f][m] || 0), 0);
  const totIng = Object.values(totIngFuente).reduce((a, b) => a + b, 0);
  const ahorro = totIng - totEgr;

  const etiquetaRango = meses.length ? `${nombreMes(meses[0], true)} – ${nombreMes(meses.at(-1), true)} (${meses.length} ${meses.length === 1 ? 'mes' : 'meses'})` : '—';
  $('#kpis').innerHTML = [
    kpi('Ingreso promedio / mes', fmt(totIng / n), `Anualizado ${fmt(totIng / n * 12)}`),
    kpi('Egreso promedio / mes', fmt(totEgr / n), `Anualizado ${fmt(totEgr / n * 12)}`),
    kpi('Ahorro promedio / mes', fmt(ahorro / n), `Anualizado ${fmt(ahorro / n * 12)}`, ahorro >= 0 ? 'pos' : 'neg'),
    kpi('Tasa de ahorro', totIng ? pct(ahorro / totIng) : '—', etiquetaRango),
  ].join('');

  // Gráfico apilado
  const datasets = [];
  const seriesEgr = conColor.map((c) => ({ c, serie: egr[c] || {} }));
  const resto = {};
  for (const c of orden) if (!conColor.includes(c)) for (const [m, v] of Object.entries(egr[c] || {})) resto[m] = (resto[m] || 0) + v;
  seriesEgr.push({ c: 'Resto', serie: resto });
  // Desglose de "Resto" por categoría, para mostrarlo en el tooltip.
  const restoCats = orden.filter((c) => !conColor.includes(c)).map((c) => ({ c, data: transformar(egr[c] || {}, meses) }));
  const surface = css('--surface');
  seriesEgr.forEach(({ c, serie }, i) => {
    datasets.push({
      type: 'bar', label: c, data: transformar(serie, meses), stack: 'egr', order: 2,
      backgroundColor: c === 'Resto' ? css('--resto') : css(color[c]),
      borderColor: surface, borderWidth: { top: 1, bottom: 1, left: 0, right: 0 }, borderSkipped: false,
      borderRadius: i === seriesEgr.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
      maxBarThickness: 44,
    });
  });
  const ingTotal = {};
  for (const f of Object.keys(ing)) for (const [m, v] of Object.entries(ing[f])) ingTotal[m] = (ingTotal[m] || 0) + v;
  datasets.push({
    type: 'line', label: 'Ingresos', data: transformar(ingTotal, meses), order: 1,
    borderColor: css('--ingreso'), backgroundColor: css('--ingreso'), borderWidth: 2,
    pointRadius: 4, pointHoverRadius: 6, pointBorderColor: surface, pointBorderWidth: 2, cubicInterpolationMode: 'monotone',
  });

  const incompletos = st.datos.completitud.por_mes;
  // Un ajuste negativo chico (p. ej. Splitwise) no debe estirar el eje hasta −100k.
  const minNeg = Math.min(0, ...meses.map((_, i) => datasets.filter((d) => d.type === 'bar').reduce((a, d) => a + Math.min(0, d.data[i]), 0)));
  const paso = 10 ** Math.floor(Math.log10(Math.max(1, Math.abs(minNeg))));
  const yMin = minNeg < 0 ? -Math.ceil(Math.abs(minNeg) / paso) * paso : 0;
  nuevoChart('ch-resumen', {
    data: { labels: meses.map((m) => nombreMes(m) + (incompletos[m] ? ' ⚠' : '')), datasets },
    options: {
      onClick: (ev, els) => { if (els.length && st.modo === 'mes') { st.detMes = meses[els[0].index]; mostrarTab('detalle'); } },
      onHover: (ev, els) => { ev.native.target.style.cursor = els.length && st.modo === 'mes' ? 'pointer' : ''; },
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: ejeX({ stacked: true }), y: ejeY({ stacked: true, min: yMin }) },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 14 } },
        tooltip: {
          itemSort: (a, b) => (a.dataset.type === 'line' ? -1 : b.dataset.type === 'line' ? 1 : b.raw - a.raw),
          filter: (it) => Math.abs(it.raw) >= 0.5,
          callbacks: {
            title: (it) => {
              const m = meses[it[0].dataIndex];
              const modo = st.modo === 'promedio' ? ' · promedio del período' : st.modo === 'movil' ? ` · media móvil ${st.ventana} meses` : '';
              return nombreMes(m, true) + modo;
            },
            label: (it) => {
              const linea = ` ${it.dataset.label}: ${fmt(it.raw)}`;
              if (it.dataset.label !== 'Resto') return linea;
              const det = restoCats.map(({ c, data }) => ({ c, v: data[it.dataIndex] }))
                .filter((d) => Math.abs(d.v) >= 0.5).sort((x, y) => y.v - x.v)
                .map((d) => `    · ${d.c}: ${fmt(d.v)}`);
              return [linea, ...det];
            },
            footer: (it) => {
              const i = it[0].dataIndex;
              const e = it.filter((x) => x.dataset.type === 'bar').reduce((a, x) => a + x.raw, 0);
              const g = it.find((x) => x.dataset.type === 'line')?.raw || 0;
              const avisos = (incompletos[meses[i]] || []).map((a) => `⚠ ${a}`);
              return [`Egresos: ${fmt(e)}`, `Ahorro: ${fmt(g - e)}`, ...avisos];
            },
          },
          footerColor: css('--ink'), footerFont: { weight: 500 },
        },
      },
    },
  });
  $('#nota-resumen').textContent = st.modo === 'promedio'
    ? 'Cada barra muestra el promedio mensual del período elegido.'
    : st.modo === 'movil' ? `Cada barra es el promedio de los últimos ${st.ventana} meses (suaviza los picos).` : 'Egresos apilados por categoría; la línea es el total de ingresos.';

  const chips = meses.filter((m) => incompletos[m]).map((m) =>
    `<span class="chip" title="${esc(incompletos[m].join(' · '))}">⚠ ${nombreMes(m)}: ${esc(incompletos[m][0])}${incompletos[m].length > 1 ? ` (+${incompletos[m].length - 1})` : ''}</span>`);
  $('#incompletos').innerHTML = chips.join('');

  // Tabla por categoría
  const filas = orden.filter((c) => Math.abs(totCat[c]) >= 0.5).sort((a, b) => totCat[b] - totCat[a]);
  const max = Math.max(...filas.map((c) => totCat[c]), 1);
  $('#tabla-cat tbody').innerHTML = filas.map((c) => `
    <tr class="clic ${st.catSel === c ? 'sel' : ''}" data-cat="${esc(c)}">
      <td><span class="sw" style="background:var(${color[c] || '--resto'})"></span>${esc(c)}
        <div class="barra" style="width:${Math.max(0, totCat[c] / max * 100)}%;background:var(${color[c] || '--resto'})"></div></td>
      <td class="num">${fmt(totCat[c])}</td>
      <td class="num">${fmt(totCat[c] / n)}</td>
      <td class="num">${totEgr ? pct(totCat[c] / totEgr) : '—'}</td>
    </tr>`).join('') + `
    <tr><td><b>Total</b></td><td class="num"><b>${fmt(totEgr)}</b></td><td class="num"><b>${fmt(totEgr / n)}</b></td><td class="num">100%</td></tr>`;
  $$('#tabla-cat tbody tr.clic').forEach((tr) => tr.addEventListener('click', () => {
    st.catSel = st.catSel === tr.dataset.cat ? null : tr.dataset.cat;
    renderResumen();
    if (st.catSel) $('#detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  // Tabla de ingresos
  const fuentes = Object.keys(totIngFuente).sort((a, b) => totIngFuente[b] - totIngFuente[a]);
  $('#tabla-ing tbody').innerHTML = fuentes.map((f) => `
    <tr class="clic ${st.catSel === f ? 'sel' : ''}" data-cat="${esc(f)}"><td>${esc(f)}</td><td class="num">${fmt(totIngFuente[f])}</td>
    <td class="num">${fmt(totIngFuente[f] / n)}</td><td class="num">${totIng ? pct(totIngFuente[f] / totIng) : '—'}</td></tr>`).join('') + `
    <tr><td><b>Total</b></td><td class="num"><b>${fmt(totIng)}</b></td><td class="num"><b>${fmt(totIng / n)}</b></td><td class="num">100%</td></tr>`;
  $$('#tabla-ing tbody tr.clic').forEach((tr) => tr.addEventListener('click', () => {
    st.catSel = st.catSel === tr.dataset.cat ? null : tr.dataset.cat;
    renderResumen();
    if (st.catSel) $('#detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  // Avisos de calidad
  const gen = st.datos.completitud.generales;
  $('#avisos').innerHTML = meses.filter((m) => incompletos[m]).map((m) => `<li><b>${nombreMes(m, true)}:</b> ${esc(incompletos[m].join('; '))}</li>`).join('')
    + gen.map((g) => `<li>${esc(g)}</li>`).join('');

  renderDetalle(meses);
}

function kpi(lbl, val, det, cls = '') {
  return `<div class="kpi"><div class="lbl">${esc(lbl)}</div><div class="val ${cls}">${esc(val)}</div><div class="det">${esc(det)}</div></div>`;
}

function renderDetalle(meses) {
  const box = $('#detalle');
  if (!st.catSel) { box.hidden = true; return; }
  box.hidden = false;
  const movs = st.datos.movimientos.filter((x) => x.categoria === st.catSel && meses.includes(x.mes)
    && (x.tipo !== 'neutro' || st.verNeutros)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const tot = movs.filter((x) => x.tipo !== 'neutro').reduce((a, x) => a + monto(x), 0);
  $('#detalle-titulo').textContent = `${st.catSel} · ${movs.length} movimientos · ${fmt(tot)}`;
  $('#tabla-mov tbody').innerHTML = movs.map((x) => `
    <tr><td class="fecha">${x.fecha.split('-').reverse().join('/')}</td><td>${esc(x.fuente)}</td>
    <td>${esc(x.desc)}${x.estimado ? ' <span class="tag est">estimado</span>' : ''}${x.nota ? `<div class="nota">${esc(x.nota)}</div>` : ''}</td>
    <td><span class="tag">${esc(x.tipo)}</span></td><td class="num">${fmt(monto(x))}</td></tr>`).join('')
    || '<tr><td colspan="5" class="nota">Sin movimientos en el período.</td></tr>';
}

// ---------- PATRIMONIO
function renderPatrimonio() {
  const p = st.datos.patrimonio;
  const conv = (a) => (st.moneda === 'usd' ? a.usd : a.uyu);
  const conocidos = p.activos.filter((a) => a.monto !== null);
  const pend = p.activos.filter((a) => a.monto === null);
  const suma = (f) => conocidos.filter(f).reduce((s, a) => s + conv(a), 0);
  const total = suma(() => true);
  const liquidez = suma((a) => a.tipo === 'liquidez');
  const inversion = suma((a) => a.tipo === 'inversion');
  const neto = suma((a) => a.tipo === 'cuenta_a_cobrar' || a.tipo === 'deuda');
  $('#kpis-pat').innerHTML = [
    kpi('Patrimonio aproximado', fmt(total), `${pend.length} activos pendientes no incluidos`),
    kpi('Liquidez', fmt(liquidez), 'Cuentas bancarias y billeteras'),
    kpi('Inversiones', fmt(inversion), 'Valor conocido (puede ser al costo)'),
    kpi('Por cobrar − deudas', fmt(neto), 'Saldos con otras personas', neto >= 0 ? 'pos' : 'neg'),
  ].join('');

  // Dona: agrupado por institución para no pasar de 4 colores.
  const grupos = {};
  const grupo = (a) => a.grupo || a.nombre;
  for (const a of conocidos) if (a.tipo !== 'deuda' && conv(a) > 0) grupos[grupo(a)] = (grupos[grupo(a)] || 0) + conv(a);
  const etiquetas = Object.keys(grupos).sort((a, b) => grupos[b] - grupos[a]);
  const totDona = etiquetas.reduce((s, k) => s + grupos[k], 0);
  nuevoChart('ch-dona', {
    type: 'doughnut',
    data: { labels: etiquetas, datasets: [{ data: etiquetas.map((k) => grupos[k]), backgroundColor: etiquetas.map((_, i) => css(`--s${i + 1}`)), borderColor: css('--surface'), borderWidth: 2 }] },
    options: {
      maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { generateLabels: (ch) => Chart.overrides.doughnut.plugins.legend.labels.generateLabels(ch).map((l, i) => ({ ...l, text: `${etiquetas[i]} · ${pct(grupos[etiquetas[i]] / totDona)}` })) } },
        tooltip: { callbacks: { label: (it) => ` ${it.label}: ${fmt(it.raw)} (${pct(it.raw / totDona)})` } },
      },
    },
  });

  // Evolución apilada (área)
  const ev = p.evolucion;
  const claves = Object.keys(ev[0] || {}).filter((k) => k !== 'mes' && k !== 'tc');
  nuevoChart('ch-evol', {
    type: 'line',
    data: {
      labels: ev.map((e) => nombreMes(e.mes)),
      datasets: claves.map((k, i) => ({
        label: k, data: ev.map((e) => (st.moneda === 'usd' ? e[k] / e.tc : e[k])), fill: true, stack: 'p',
        borderColor: css(`--s${i + 1}`), backgroundColor: css(`--s${i + 1}`) + '55', borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, cubicInterpolationMode: 'monotone',
      })),
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: ejeX(), y: ejeY({ stacked: true, beginAtZero: true }) },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${fmt(it.raw)}`, footer: (it) => `Total: ${fmt(it.reduce((a, x) => a + x.raw, 0))}` }, footerColor: css('--ink') },
      },
    },
  });

  const tipoNom = { liquidez: 'Liquidez', inversion: 'Inversión', cuenta_a_cobrar: 'Por cobrar', deuda: 'Deuda' };
  const fmtOrig = (a) => `${a.moneda === 'UYU' ? '$' : a.moneda === 'USD' ? 'US$' : '€'} ${new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 }).format(a.monto)}`;
  $('#tabla-pat tbody').innerHTML = p.activos.map((a) => `
    <tr><td>${esc(a.nombre)}</td><td><span class="tag">${tipoNom[a.tipo] || a.tipo}</span></td>
    <td class="num">${a.monto === null ? '<span class="tag pend">pendiente</span>' : (a.tipo === 'deuda' ? '−' : '') + fmtOrig(a)}</td>
    <td class="num">${a.monto === null ? '—' : fmt(conv(a))}</td>
    <td class="fecha">${a.fecha ? a.fecha.split('-').reverse().join('/') : '—'}</td><td class="nota">${esc(a.nota)}</td></tr>`).join('') + `
    <tr><td colspan="3"><b>Total conocido</b></td><td class="num"><b>${fmt(total)}</b></td><td colspan="2" class="nota">TC ${p.tc_actual} $/US$</td></tr>`;
}

// ---------- TENDENCIAS (small multiples: una categoría por mini gráfico)
function renderTendencias() {
  const meses = mesesRango();
  const egr = sumarPor('egreso');
  const { orden } = categoriasConColor();
  const tot = (c) => meses.reduce((a, m) => a + (egr[c]?.[m] || 0), 0);
  const cats = orden.filter((c) => Math.abs(tot(c)) >= 0.5).sort((a, b) => tot(b) - tot(a));
  const series = Object.fromEntries(cats.map((c) => [c, transformar(egr[c] || {}, meses)]));
  const maxComun = Math.max(...cats.flatMap((c) => series[c]), 0);
  const cont = $('#multiples');
  Object.keys(charts).filter((k) => k.startsWith('mini-')).forEach((k) => { charts[k].destroy(); delete charts[k]; });
  cont.innerHTML = cats.map((c, i) => `
    <div class="mini"><h3>${esc(c)} <span>${fmt(tot(c) / (meses.length || 1))}/mes</span></h3>
    <div class="chart-wrap"><canvas id="mini-${i}" aria-label="Gasto mensual en ${esc(c)}"></canvas></div></div>`).join('');
  const acc = css('--accent');
  cats.forEach((c, i) => {
    const prom = tot(c) / (meses.length || 1);
    nuevoChart(`mini-${i}`, {
      type: 'line',
      data: {
        labels: meses.map((m) => nombreMes(m)),
        datasets: [
          { label: c, data: series[c], borderColor: acc, backgroundColor: acc + '22', fill: true, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, cubicInterpolationMode: 'monotone' },
          { label: 'Promedio', data: meses.map(() => prom), borderColor: css('--muted'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0 },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: ejeX({ ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5, font: { size: 10 } } }),
          y: ejeY({ beginAtZero: true, max: st.escala === 'comun' ? maxComun * 1.05 : undefined, ticks: { callback: (v) => fmtCorto(v), maxTicksLimit: 3, font: { size: 10 } } }),
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${fmt(it.raw)}` } } },
      },
    });
  });
}

// ---------- tema, navegación, filtros
const ICONO_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICONO_LUNA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const temaActual = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function pintarBotonTema() {
  const oscuro = temaActual() === 'dark';
  $('#tema').innerHTML = oscuro ? ICONO_SOL : ICONO_LUNA;
  $('#tema').title = oscuro ? 'Pasar a tema claro' : 'Pasar a tema oscuro';
}

function render() {
  estiloChart();
  if (st.tab === 'resumen') renderResumen();
  if (st.tab === 'patrimonio') renderPatrimonio();
  if (st.tab === 'tendencias') renderTendencias();
  if (st.tab === 'detalle') renderDetalleMes();
  if (st.tab === 'revisar') renderRevisar();
  pintarBadge();
}

// ---------- REVISAR CATEGORÍAS
// Los cambios se guardan en config/reasignaciones.json vía el servidor local (./serve.sh).
// En la versión publicada no hay servidor: quedan en este navegador y se pueden exportar.
const leerPend = () => { try { return JSON.parse(localStorage.getItem('reasignaciones') || '{}'); } catch (e) { return {}; } };
const guardarPend = (o) => { try { localStorage.setItem('reasignaciones', JSON.stringify(o)); } catch (e) {} };

function aplicarReasignacion(x, cat) {
  if (!x.catOriginal) x.catOriginal = x.categoria;
  x.categoria = cat || x.catOriginal;
  x.revisado = !!cat;
}

function aplicarPendientes() {
  const pend = leerPend();
  for (const x of st.datos.movimientos) if (pend[x.id]) aplicarReasignacion(x, pend[x.id].categoria);
}

async function guardarCambios(cambios) {
  for (const c of cambios) aplicarReasignacion(c.x, c.categoria);
  const cuerpo = { cambios: cambios.map((c) => ({ id: c.x.id, categoria: c.categoria, desc: c.x.desc })) };
  let ok = false;
  if (st.local) {
    try { ok = (await fetch('/api/reasignar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })).ok; } catch (e) {}
  }
  if (!ok) {
    const pend = leerPend();
    for (const c of cuerpo.cambios) { if (c.categoria) pend[c.id] = c; else delete pend[c.id]; }
    guardarPend(pend);
  }
  render();
}

const pendientesRevision = () => st.datos.movimientos.filter((x) => x.tipo === 'egreso' && x.duda > 0 && !x.revisado);

function pintarBadge() {
  const n = pendientesRevision().length;
  $('#rev-badge').textContent = n ? String(n) : '';
}

function renderRevisar() {
  const selMes = $('#rev-mes');
  if (!selMes.options.length) {
    selMes.innerHTML = '<option value="*">Todos los meses</option>' + st.datos.meses.map((m) => `<option value="${m}">${nombreMes(m, true)}</option>`).join('');
  }
  selMes.value = st.revMes;
  const todos = st.datos.movimientos.filter((x) => x.tipo === 'egreso' && (x.duda > 0 || x.revisado));
  const pend = pendientesRevision();
  const porNivel = (n) => pend.filter((x) => x.duda === n);
  const s = (xs) => xs.reduce((a, x) => a + monto(x), 0);
  $('#rev-kpis').innerHTML = [
    kpi('Por revisar', String(pend.length), fmt(s(pend))),
    kpi('Duda alta', String(porNivel(3).length), fmt(s(porNivel(3))), porNivel(3).length ? 'neg' : ''),
    kpi('Duda media', String(porNivel(2).length), fmt(s(porNivel(2)))),
    kpi('Revisados', String(todos.filter((x) => x.revisado).length), 'Con categoría confirmada o cambiada', 'pos'),
  ].join('');

  const pendLocal = Object.keys(leerPend()).length;
  const sync = $('#rev-sync');
  sync.hidden = !pendLocal;
  if (pendLocal) {
    sync.innerHTML = `<span>${pendLocal} ${pendLocal === 1 ? 'cambio guardado' : 'cambios guardados'} solo en este navegador${st.local ? '' : ' (la versión publicada no puede escribir en tu máquina)'}.</span><button class="boton" id="rev-exportar">Exportar reasignaciones</button>`;
    $('#rev-exportar').addEventListener('click', () => {
      const pend = leerPend();
      const obj = Object.fromEntries(Object.entries(pend).map(([k, v]) => [k, { categoria: v.categoria, desc: v.desc }]));
      const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'reasignaciones.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  const lista = todos.filter((x) => (st.revHechos || !x.revisado)
    && (!st.revNivel || x.duda === st.revNivel)
    && (st.revMes === '*' || x.mes === st.revMes)
    && coincide(x, st.revBuscar))
    .sort((a, b) => Math.abs(b.uyu) - Math.abs(a.uyu) || b.duda - a.duda);
  const cats = [...new Set([...st.datos.orden_categorias, ...st.datos.movimientos.filter((x) => x.tipo === 'egreso').map((x) => x.categoria)])];
  const nombreN = { 3: 'Alta', 2: 'Media', 1: 'Baja' };
  const clave = (x) => normal(x.desc.replace(/\(.*?\)/g, '').replace(/\d+/g, '')).trim();
  const visibles = lista.slice(0, st.revLimite);
  $('#rev-tabla tbody').innerHTML = visibles.map((x) => {
    const iguales = pend.filter((y) => y !== x && clave(y) === clave(x)).length;
    return `<tr data-id="${esc(x.id)}" class="${x.revisado ? 'hecho' : ''}">
      <td class="fecha">${fechaUy(x.fecha)}</td>
      <td>${esc(x.desc)}<div class="nota">${esc(x.fuente)}${x.nota ? ' · ' + esc(x.nota) : ''}</div></td>
      <td class="num">${fmt(monto(x))}</td>
      <td>${x.revisado ? '<span class="duda ok">revisado</span>' : `<span class="duda n${x.duda}" title="${esc(x.motivo)}">${nombreN[x.duda]}</span><div class="nota">${esc(x.motivo)}</div>`}</td>
      <td><select data-id="${esc(x.id)}">${cats.map((c) => `<option ${c === x.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        ${!x.revisado && iguales ? `<button class="iguales" data-id="${esc(x.id)}">Aplicar a ${iguales} ${iguales === 1 ? 'igual' : 'iguales'}</button>` : ''}</td>
      <td>${x.revisado ? `<button class="ok-btn" data-deshacer="${esc(x.id)}" title="Volver a la categoría automática">↺</button>` : `<button class="ok-btn" data-ok="${esc(x.id)}" title="La categoría está bien">✓</button>`}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="nota">Nada para revisar con estos filtros. 🎉</td></tr>';
  $('#rev-mas').hidden = lista.length <= st.revLimite;
  $('#rev-mas').textContent = `Ver más (${lista.length - st.revLimite})`;

  const porId = Object.fromEntries(st.datos.movimientos.map((x) => [x.id, x]));
  $$('#rev-tabla select').forEach((sel) => sel.addEventListener('change', () => guardarCambios([{ x: porId[sel.dataset.id], categoria: sel.value }])));
  $$('#rev-tabla [data-ok]').forEach((b) => b.addEventListener('click', () => { const x = porId[b.dataset.ok]; guardarCambios([{ x, categoria: x.categoria }]); }));
  $$('#rev-tabla [data-deshacer]').forEach((b) => b.addEventListener('click', () => guardarCambios([{ x: porId[b.dataset.deshacer], categoria: null }])));
  $$('#rev-tabla .iguales').forEach((b) => b.addEventListener('click', () => {
    const x = porId[b.dataset.id];
    const cat = $(`#rev-tabla select[data-id="${CSS.escape(x.id)}"]`).value;
    guardarCambios([x, ...pend.filter((y) => y !== x && clave(y) === clave(x))].map((y) => ({ x: y, categoria: cat })));
  }));
}

// ---------- DETALLE MENSUAL
const TODO = '*';
const mesesCompletos = () => {
  const hoy = new Date().toISOString().slice(0, 7);
  const ms = st.datos.meses.filter((m) => m < hoy);
  return ms.length ? ms : st.datos.meses;
};
const fechaUy = (f) => f.split('-').reverse().join('/');
const normal = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function coincide(x, q) {
  if (!q) return true;
  const hay = normal(`${x.desc} ${x.nota || ''} ${x.fuente} ${x.categoria} ${Math.round(Math.abs(x.uyu))} ${Math.abs(x.usd).toFixed(2)}`);
  return normal(q).split(/\s+/).every((p) => hay.includes(p));
}

function resaltar(texto, q) {
  const t = esc(texto);
  if (!q) return t;
  let out = t;
  for (const p of q.trim().split(/\s+/).filter((w) => w.length > 1)) {
    const re = new RegExp(`(${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

function lineasDetalle() {
  const meses = st.detMes === TODO ? mesesCompletos() : [st.detMes];
  return st.datos.movimientos.filter((x) => meses.includes(x.mes) && coincide(x, st.detBuscar));
}

function tablaLineas(movs, q) {
  return `<div class="scroll"><table class="tabla"><thead><tr><th>Fecha</th><th>Descripción</th><th>Fuente</th><th class="num">Monto</th></tr></thead><tbody>${
    movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || monto(b) - monto(a)).map((x) => `
    <tr><td class="fecha">${fechaUy(x.fecha)}</td>
    <td>${resaltar(x.desc, q)}${x.estimado ? ' <span class="tag est">estimado</span>' : ''}${x.nota ? `<div class="nota">${resaltar(x.nota, q)}</div>` : ''}</td>
    <td><span class="tag">${esc(x.fuente)}</span></td><td class="num">${fmt(monto(x))}</td></tr>`).join('')}</tbody></table></div>`;
}

function bloqueCategorias(movs, clave, { colores = {}, promedios = {}, esIngreso = false, nMeses = 1 } = {}) {
  const grupos = {};
  for (const x of movs) (grupos[x[clave]] ||= []).push(x);
  const tot = (xs) => xs.reduce((a, x) => a + monto(x), 0);
  const nombres = Object.keys(grupos).sort((a, b) => tot(grupos[b]) - tot(grupos[a]));
  const total = nombres.reduce((a, c) => a + tot(grupos[c]), 0);
  const max = Math.max(1, ...nombres.map((c) => tot(grupos[c])));
  const q = st.detBuscar;
  const html = nombres.map((c) => {
    const t = tot(grupos[c]);
    const prom = promedios[c];
    const enMes = t / nMeses;
    let delta = '';
    if (prom !== undefined && prom > 0) {
      const d = enMes / prom - 1;
      delta = `<span class="delta ${d > 0.1 ? 'up' : d < -0.1 ? 'down' : ''}" title="Promedio mensual del año: ${fmt(prom)}">${d >= 0 ? '+' : ''}${Math.round(d * 100)}% vs. prom.</span>`;
    } else if (prom !== undefined) delta = '<span>—</span>';
    const abierta = st.detAbiertas.has(clave + c) || (q && grupos[c].length <= 60);
    const colorBarra = colores[c] ? css(colores[c]) : css('--resto');
    return `<details class="cat ${esIngreso ? 'ing' : ''}" data-k="${esc(clave + c)}" ${abierta ? 'open' : ''}>
      <summary><span class="flecha">▶</span>
        <span class="nom"><b>${esc(c)}</b><span class="barra"><i style="width:${Math.max(2, (t / max) * 100)}%;background:${colorBarra}"></i></span></span>
        <span class="cifras"><span class="tot">${fmt(t)}</span><span>${total ? pct(t / total) : '—'}</span><span>${grupos[c].length} mov.</span>${delta || '<span></span>'}</span>
      </summary>
      <div class="lineas">${tablaLineas(grupos[c], q)}</div>
    </details>`;
  }).join('');
  return (html || '<p class="nota">Sin movimientos.</p>') + (nombres.length ? `<div class="det-total"><span>Total</span><span>${fmt(total)}</span></div>` : '');
}

function promediosMensuales(tipo, clave) {
  const ms = mesesCompletos();
  const acc = {};
  for (const x of st.datos.movimientos) if (x.tipo === tipo && ms.includes(x.mes)) acc[x[clave]] = (acc[x[clave]] || 0) + monto(x);
  for (const k of Object.keys(acc)) acc[k] /= ms.length;
  return acc;
}

function renderDetalleMes() {
  const sel = $('#det-mes');
  if (!sel.options.length) {
    sel.innerHTML = st.datos.meses.map((m) => `<option value="${m}">${nombreMes(m, true)}</option>`).join('')
      + `<option value="${TODO}">Todo el período (${nombreMes(mesesCompletos()[0], true)} – ${nombreMes(mesesCompletos().at(-1), true)})</option>`;
  }
  if (!st.detMes) st.detMes = leer('detMes') || mesesCompletos().at(-1);
  sel.value = st.detMes;
  guardar('detMes', st.detMes);
  const esTodo = st.detMes === TODO;
  const nMeses = esTodo ? mesesCompletos().length : 1;
  const movs = lineasDetalle();
  const egr = movs.filter((x) => x.tipo === 'egreso');
  const ing = movs.filter((x) => x.tipo === 'ingreso');
  const neu = movs.filter((x) => x.tipo === 'neutro');
  const s = (xs) => xs.reduce((a, x) => a + monto(x), 0);
  const tE = s(egr), tI = s(ing);
  const promE = Object.values(promediosMensuales('egreso', 'categoria')).reduce((a, b) => a + b, 0);
  const sufijo = esTodo ? ` · ${nMeses} meses` : '';
  $('#det-kpis').innerHTML = [
    kpi('Ingresos', fmt(tI), esTodo ? `Promedio ${fmt(tI / nMeses)} / mes` : nombreMes(st.detMes, true)),
    kpi('Egresos', fmt(tE), esTodo ? `Promedio ${fmt(tE / nMeses)} / mes` : `Promedio del año ${fmt(promE)}`),
    kpi('Ahorro', fmt(tI - tE), tI ? `Tasa ${pct((tI - tE) / tI)}${sufijo}` : sufijo, tI - tE >= 0 ? 'pos' : 'neg'),
    kpi('Movimientos', String(egr.length + ing.length), `${neu.length} neutros${st.detBuscar ? ' · filtrado' : ''}`),
  ].join('');
  const avisos = esTodo ? [] : (st.datos.completitud.por_mes[st.detMes] || []);
  $('#det-avisos').innerHTML = avisos.map((a) => `<span class="chip">⚠ ${esc(a)}</span>`).join('');
  const { color } = categoriasConColor();
  $('#det-titulo').textContent = `Egresos por categoría · ${esTodo ? 'todo el período' : nombreMes(st.detMes, true)}`;
  $('#det-egresos').innerHTML = bloqueCategorias(egr, 'categoria', { colores: color, promedios: st.detBuscar ? {} : promediosMensuales('egreso', 'categoria'), nMeses });
  $('#det-ingresos').innerHTML = bloqueCategorias(ing, 'categoria', { promedios: st.detBuscar ? {} : promediosMensuales('ingreso', 'categoria'), esIngreso: true, nMeses });
  $('#det-neutros-card').hidden = !st.detNeutros;
  if (st.detNeutros) $('#det-neutros-lista').innerHTML = bloqueCategorias(neu, 'categoria', { nMeses });
  $$('#tab-detalle details.cat').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) st.detAbiertas.add(d.dataset.k); else st.detAbiertas.delete(d.dataset.k);
  }));
  const i = st.datos.meses.indexOf(st.detMes);
  $('#det-prev').disabled = esTodo || i <= 0;
  $('#det-next').disabled = esTodo || i >= st.datos.meses.length - 1;
}

function exportarCSV() {
  const movs = lineasDetalle().filter((x) => x.tipo !== 'neutro' || st.detNeutros).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = [['fecha', 'tipo', 'categoria', 'descripcion', 'fuente', 'monto_uyu', 'monto_usd', 'nota']]
    .concat(movs.map((x) => [x.fecha, x.tipo, x.categoria, x.desc, x.fuente, x.uyu, x.usd, x.nota || '']));
  const blob = new Blob(['\ufeff' + filas.map((f) => f.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finanzas_${st.detMes === TODO ? 'periodo' : st.detMes}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setPressed(sel, attr, val) {
  $$(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
}

function iniciar(datos) {
  st.datos = datos;
  aplicarPendientes();
  const meses = datos.meses;
  const opciones = meses.map((m) => `<option value="${m}">${nombreMes(m, true)}</option>`).join('');
  $('#desde').innerHTML = opciones;
  $('#hasta').innerHTML = opciones;
  // Por defecto: hasta el último mes con datos completos de tarjetas (el mes en curso queda afuera).
  const ultimoCompleto = meses.filter((m) => m < new Date().toISOString().slice(0, 7)).at(-1) || meses.at(-1);
  st.desde = leer('desde') && meses.includes(leer('desde')) ? leer('desde') : meses[0];
  st.hasta = leer('hasta') && meses.includes(leer('hasta')) ? leer('hasta') : ultimoCompleto;
  st.moneda = leer('moneda') || 'uyu';
  st.tab = leer('tab') || 'resumen';
  $('#desde').value = st.desde; $('#hasta').value = st.hasta;
  $('#generado').textContent = `Datos generados el ${new Date(datos.generado).toLocaleString('es-UY', { dateStyle: 'medium', timeStyle: 'short' })} · solo 2026 en adelante`;

  $('#desde').addEventListener('change', (e) => { st.desde = e.target.value; if (st.hasta < st.desde) { st.hasta = st.desde; $('#hasta').value = st.hasta; } guardar('desde', st.desde); render(); });
  $('#hasta').addEventListener('change', (e) => { st.hasta = e.target.value; if (st.desde > st.hasta) { st.desde = st.hasta; $('#desde').value = st.desde; } guardar('hasta', st.hasta); render(); });
  $$('[data-modo]').forEach((b) => b.addEventListener('click', () => { st.modo = b.dataset.modo; setPressed('[data-modo]', 'modo', st.modo); $('#ventana-wrap').hidden = st.modo !== 'movil'; render(); }));
  $('#ventana').addEventListener('change', (e) => { st.ventana = +e.target.value; render(); });
  $$('[data-moneda]').forEach((b) => b.addEventListener('click', () => { st.moneda = b.dataset.moneda; guardar('moneda', st.moneda); setPressed('[data-moneda]', 'moneda', st.moneda); render(); }));
  $$('[data-escala]').forEach((b) => b.addEventListener('click', () => { st.escala = b.dataset.escala; setPressed('[data-escala]', 'escala', st.escala); render(); }));
  $('#ver-neutros').addEventListener('change', (e) => { st.verNeutros = e.target.checked; renderDetalle(mesesRango()); });
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
  $('#det-mes').addEventListener('change', (e) => { st.detMes = e.target.value; render(); });
  const moverMes = (d) => { const i = st.datos.meses.indexOf(st.detMes) + d; if (i >= 0 && i < st.datos.meses.length) { st.detMes = st.datos.meses[i]; render(); } };
  $('#det-prev').addEventListener('click', () => moverMes(-1));
  $('#det-next').addEventListener('click', () => moverMes(1));
  let tBuscar;
  $('#det-buscar').addEventListener('input', (e) => { clearTimeout(tBuscar); tBuscar = setTimeout(() => { st.detBuscar = e.target.value.trim(); render(); }, 150); });
  $('#det-neutros').addEventListener('change', (e) => { st.detNeutros = e.target.checked; render(); });
  $('#det-expandir').addEventListener('click', () => {
    const ds = $$('#tab-detalle details.cat');
    const abrir = ds.some((d) => !d.open);
    ds.forEach((d) => { d.open = abrir; });
    $('#det-expandir').textContent = abrir ? 'Contraer todo' : 'Expandir todo';
  });
  $('#det-csv').addEventListener('click', exportarCSV);
  $$('[data-nivel]').forEach((b) => b.addEventListener('click', () => { st.revNivel = +b.dataset.nivel; setPressed('[data-nivel]', 'nivel', b.dataset.nivel); st.revLimite = 60; render(); }));
  $('#rev-mes').addEventListener('change', (e) => { st.revMes = e.target.value; st.revLimite = 60; render(); });
  let tRev;
  $('#rev-buscar').addEventListener('input', (e) => { clearTimeout(tRev); tRev = setTimeout(() => { st.revBuscar = e.target.value.trim(); render(); }, 150); });
  $('#rev-hechos').addEventListener('change', (e) => { st.revHechos = e.target.checked; render(); });
  $('#rev-mas').addEventListener('click', () => { st.revLimite += 60; render(); });
  $('#tema').addEventListener('click', () => {
    const nuevo = temaActual() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nuevo; guardar('tema', nuevo); pintarBotonTema(); render();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { pintarBotonTema(); render(); });

  setPressed('[data-moneda]', 'moneda', st.moneda);
  pintarBotonTema();
  mostrarTab(st.tab);
}

function mostrarTab(tab) {
  st.tab = tab; guardar('tab', tab);
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  $('.filtros').style.display = ['patrimonio', 'detalle', 'revisar'].includes(tab) ? 'none' : '';
  render();
}

/* Carga de datos. En local se lee data/finanzas.json en claro. Publicado, solo existe
   datos/finanzas.enc.json (AES-256-GCM, clave derivada con PBKDF2-SHA256) y se pide la contraseña. */
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function descifrar(sobre, clave) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(sobre.salt), iterations: sobre.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(sobre.iv) }, key, b64(sobre.ct));
  return JSON.parse(new TextDecoder().decode(plano));
}

function pedirClave(sobre) {
  const login = $('#login');
  const form = $('#login-form');
  const err = $('#login-error');
  document.body.classList.add('bloqueado');
  login.hidden = false;
  $('#login-clave').focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const clave = $('#login-clave').value;
    err.textContent = 'Descifrando…';
    try {
      const datos = await descifrar(sobre, clave);
      try { sessionStorage.setItem('clave', clave); } catch (e) {}
      login.hidden = true;
      document.body.classList.remove('bloqueado');
      iniciar(datos);
    } catch (e) {
      err.textContent = 'Contraseña incorrecta.';
      $('#login-clave').select();
    }
  });
}

async function cargar() {
  const plano = await fetch('data/finanzas.json', { cache: 'no-store' }).catch(() => null);
  if (plano && plano.ok) { st.local = true; return iniciar(await plano.json()); }
  const r = await fetch('datos/finanzas.enc.json', { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) {
    document.querySelector('main').innerHTML = '<article class="card"><h2>No encuentro los datos</h2><p class="nota">Corré <code>./serve.sh</code> en local, o <code>make publicar</code> para generar la versión cifrada.</p></article>';
    return;
  }
  const sobre = await r.json();
  let guardada = null;
  try { guardada = sessionStorage.getItem('clave'); } catch (e) {}
  if (guardada) {
    try { return iniciar(await descifrar(sobre, guardada)); } catch (e) {}
  }
  pedirClave(sobre);
}

$('#salir').addEventListener('click', () => {
  try { sessionStorage.removeItem('clave'); } catch (e) {}
  location.reload();
});

cargar();
