/* Mis finanzas: dashboard estático que lee data/finanzas.json (generado por scripts/build_data.py). */
'use strict';

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const N_SLOTS = 7; // categorías con color propio; el resto se agrupa en "Resto"

const st = {
  datos: null, moneda: 'uyu', desde: null, hasta: null, modo: 'mes', ventana: 3,
  tab: 'resumen', escala: 'propia', catSel: null, verNeutros: false,
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
            label: (it) => ` ${it.dataset.label}: ${fmt(it.raw)}`,
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
}

function setPressed(sel, attr, val) {
  $$(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
}

function iniciar(datos) {
  st.datos = datos;
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
  $('.filtros').style.display = tab === 'patrimonio' ? 'none' : '';
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
  if (plano && plano.ok) return iniciar(await plano.json());
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
