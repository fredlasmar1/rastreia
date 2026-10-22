/**
 * RASTREIA — Relatório INTERNO da revisão (diagnóstico estratégico) em HTML.
 *
 * Uma fonte só para a análise rápida (/revisao-contratos.html), a tela do
 * pedido (/pedido.html) e o PDF interno (imprimir): o servidor monta o HTML e
 * as telas só encaixam. Ordem pensada para ler em 30 segundos:
 *   placar (vale? quanto? o que fazer agora?) → em 30 segundos → argumentos
 *   (detalhe recolhido) → riscos → plano → não prometer → documentos/mensagem.
 * USO INTERNO: nunca entra no laudo nem no relatório do cliente.
 */
const { placar: montarPlacar } = require('./revisao_diagnostico');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DECISAO = {
  entrar: ['#14532d', '#dcfce7', '#16a34a'],
  negociar: ['#713f12', '#fef9c3', '#ca8a04'],
  documentos: ['#0c4a6e', '#e0f2fe', '#0284c7'],
  nao: ['#374151', '#f3f4f6', '#6b7280']
};
const FORCA = { alta: ['Forte', '#dc2626', '#fee2e2', '#991b1b'], media: ['Médio', '#d97706', '#fef3c7', '#92400e'], baixa: ['Fraco', '#94a3b8', '#f1f5f9', '#475569'] };
// Prazos do contrato que DISPARAM problema (desistência, por exemplo, não é risco)
const RE_RISCO = /bloque|venc|execu|garanti|refor|cobran|negativ|protest|leil|consolid|busca/i;

const CSS = `<style>
.dgx{--t:#0f172a;--s:#64748b;--l:#e2e8f0;font-family:inherit;color:var(--t);font-size:14px;line-height:1.45}
.dgx *{box-sizing:border-box}
.dgx .tarja{display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:800;letter-spacing:.04em;padding:3px 10px;border-radius:99px;margin-bottom:10px}
.dgx h4{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--s);margin:22px 0 8px}
.dgx .placar{display:grid;grid-template-columns:1.2fr 1fr 1.3fr;gap:10px}
.dgx .cx{border:1px solid var(--l);border-radius:14px;padding:14px 16px;background:#fff}
.dgx .rot{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--s);margin-bottom:4px}
.dgx .dec{border:0}
.dgx .dec .big{font-size:24px;font-weight:900;letter-spacing:-.01em;line-height:1.1;margin-bottom:4px}
.dgx .num{font-size:22px;font-weight:800;white-space:nowrap}
.dgx .vale{flex:0 0 auto;margin-left:auto;font-size:12px;font-weight:800;color:#15803d;background:#dcfce7;border-radius:99px;padding:2px 8px;white-space:nowrap}
.dgx .num s{font-size:14px;color:var(--s);font-weight:500;margin-right:4px}
.dgx .mini{font-size:12px;color:var(--s)}
.dgx .linha-num{display:block;padding:5px 0;border-bottom:1px dashed var(--l)}
.dgx .linha-num .num{display:block}
.dgx .linha-num:last-child{border-bottom:0}
.dgx .passo{font-weight:700}
.dgx .adv{display:inline-block;font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:6px;padding:1px 6px;margin-top:4px}
.dgx .t30{display:grid;gap:6px}
.dgx .t30 div{display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-radius:10px;background:#f8fafc}
.dgx .t30 b{flex:0 0 132px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.dgx .arg{border:1px solid var(--l);border-left:5px solid var(--c);border-radius:10px;background:#fff;margin-bottom:6px}
.dgx .arg summary{list-style:none;cursor:pointer;padding:9px 12px;display:flex;gap:10px;align-items:baseline}
.dgx .arg summary::-webkit-details-marker{display:none}
.dgx .arg summary .pill{flex:0 0 auto;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:uppercase}
.dgx .arg summary>span:nth-child(2){flex:1 1 auto;min-width:0}
.dgx .arg summary .tt{font-weight:700}
.dgx .arg summary .pq{display:block;font-weight:400;color:#334155;font-size:13px;margin-top:2px}
.dgx .arg summary .mais{margin-left:auto;font-size:12px;color:var(--s);white-space:nowrap}
.dgx .arg[open] summary .mais{visibility:hidden}
.dgx .det{padding:0 12px 10px 12px;font-size:13px;display:grid;gap:4px}
.dgx .det .tr{font-style:italic;color:var(--s);border-left:3px solid var(--l);padding-left:8px}
.dgx .riscos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dgx ul{margin:0;padding-left:18px}.dgx li{margin-bottom:5px}
.dgx .prazos{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dgx .prazos span{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:3px 8px;font-size:12px}
.dgx .prazos b{color:#c2410c}
.dgx .plano{counter-reset:p;display:grid;gap:8px}
.dgx .plano>div{display:grid;grid-template-columns:28px 1fr;gap:10px}
.dgx .plano>div:before{counter-increment:p;content:counter(p);width:28px;height:28px;border-radius:99px;background:var(--t);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:13px}
.dgx .plano .quando{font-size:12px;font-weight:700;color:var(--s)}
.dgx .cartas{background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:10px 14px}
.dgx .nao{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px 14px}
.dgx .docs label{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed var(--l);font-size:13px}
.dgx .msg{white-space:pre-wrap;font-size:13px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px}
.dgx .duas{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.dgx .rodape{font-size:11px;color:var(--s);margin-top:16px}
@media (max-width:900px){.dgx .placar,.dgx .riscos,.dgx .duas{grid-template-columns:1fr}.dgx .t30 b{flex-basis:96px}}
@media print{.dgx .arg,.dgx .cx,.dgx .plano>div{break-inside:avoid}.dgx .arg summary .mais,.dgx .no-print{display:none}.dgx{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>`;

/**
 * renderizar(g, calc, { idMsg }) → fragmento HTML (com <style> próprio).
 * g = diagnóstico gravado; calc = cálculo do mesmo caso (para o placar de
 * diagnósticos gravados antes do placar existir).
 */
function renderizar(g, calc = null, { idMsg = 'dgx-msg' } = {}) {
  if (!g || !Array.isArray(g.achados)) return '';
  const p = g.placar || montarPlacar(g, calc);
  const [cor, fundo, borda] = DECISAO[p.decisao.codigo] || DECISAO.nao;
  let h = CSS + `<div class="dgx"><div class="tarja">USO INTERNO — Recobro / Balladão · não vai para o cliente</div>`;

  // 1) Placar
  const jogo = p.em_jogo.length
    ? p.em_jogo.map(x => `<div class="linha-num"><span class="mini">${esc(x.rotulo)}${x.nota ? ` · ${esc(x.nota)}` : ''}</span><span class="num" style="font-size:17px">${x.de != null ? `<s>${brl(x.de)}</s>` : ''}${brl(x.valor)}</span></div>`).join('')
    : `<div class="num" style="font-size:17px;color:#0369a1">Ainda não calculável</div><div class="mini">Falta: ${esc(p.falta)}</div>${(p.contexto || []).map(x => `<div class="mini" style="margin-top:6px;color:var(--t)">${esc(x)}</div>`).join('')}`;
  h += `<div class="placar">
    <div class="cx dec" style="background:${fundo};color:${cor};box-shadow:inset 0 0 0 2px ${borda}"><div class="rot" style="color:${cor}">Vale a pena?</div><div class="big">${esc(p.decisao.rotulo)}</div><div style="font-size:13px">${esc(p.decisao.porque)}</div>
      <div class="mini" style="color:${cor};margin-top:6px">${p.contagem.fortes} forte(s) · ${p.contagem.medios} médio(s) · ${p.contagem.fracos} fraco(s)</div></div>
    <div class="cx"><div class="rot">Quanto está em jogo</div>${jogo}</div>
    <div class="cx"><div class="rot">Fazer agora</div>${p.proximo ? `<div class="passo">${esc(p.proximo.acao)}</div><div class="mini" style="margin-top:4px">${esc(p.proximo.porque)}</div>${p.proximo.confirmar_advogado ? '<span class="adv">Confirmar com o advogado antes</span>' : ''}` : '<div class="mini">Sem ação urgente.</div>'}</div>
  </div>`;

  // 2) Em 30 segundos
  const T30 = { argumento: ['Melhor argumento', '#16a34a'], risco: ['Maior risco', '#dc2626'], nao_prometer: ['Não prometer', '#64748b'] };
  if (p.em_30s.length) h += `<h4>Em 30 segundos</h4><div class="t30">${p.em_30s.map(x => `<div><b style="color:${T30[x.tipo][1]}">${T30[x.tipo][0]}</b><span>${esc(x.texto)}</span></div>`).join('')}</div>`;

  // 3) Argumentos, do mais forte ao mais fraco — detalhe recolhido
  h += `<h4>Argumentos (${g.achados.length}) — clique para ver cláusula, lei e defesa do banco</h4>`;
  h += g.achados.length ? g.achados.map(a => {
    const f = FORCA[a.forca] || FORCA.baixa;
    const det = [
      a.clausula ? `<div><b>Onde:</b> ${esc(a.clausula)}</div>` : '',
      a.trecho ? `<div class="tr">“${esc(a.trecho)}”</div>` : '',
      a.base ? `<div><b>Fundamento:</b> ${esc(a.base)}</div>` : '',
      a.defesa_banco ? `<div><b>O banco vai dizer:</b> ${esc(a.defesa_banco)}</div>` : ''
    ].join('');
    return `<details class="arg" style="--c:${f[1]}"><summary><span class="pill" style="background:${f[2]};color:${f[3]}">${f[0]}</span><span><span class="tt">${esc(a.titulo)}</span><span class="pq">${esc(a.porque)}</span></span>${a.impacto ? `<span class="vale" title="${esc(a.impacto.nota || '')}">≈ ${brl(a.impacto.valor)}${a.impacto.grupo ? ' *' : ''}</span>` : ''}${det ? '<span class="mais">detalhes ▾</span>' : ''}</summary>${det ? `<div class="det">${det}</div>` : ''}</details>`;
  }).join('') + (g.achados.some(a => a.impacto?.grupo) ? '<div class="mini">* Tarifas e seguros indevidos saem juntos do valor financiado: o valor marcado é o do conjunto, não de cada um.</div>' : '') : '<div class="mini">Nenhum argumento encontrado no contrato.</div>';

  // 4) Riscos para o cliente: prejuízo + garantias + prazos que disparam problema
  const prazos = (g.linha_do_tempo || []).filter(t => RE_RISCO.test(t.evento || ''));
  if ((g.maior_prejuizo || []).length || (g.garantias || []).length || prazos.length) {
    h += `<h4>Riscos para o cliente</h4><div class="riscos">
      <div class="cx"><div class="rot">O que pode piorar a dívida</div>${(g.maior_prejuizo || []).length ? `<ul>${g.maior_prejuizo.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="mini">—</div>'}
        ${prazos.length ? `<div class="rot" style="margin-top:10px">Prazos do contrato</div><div class="prazos">${prazos.map(t => `<span>${t.dias != null ? `<b>${esc(t.dias)} dia(s)</b> · ` : ''}${esc(t.evento)}</span>`).join('')}</div>` : ''}</div>
      <div class="cx"><div class="rot">Quem responde e com o quê</div>${(g.garantias || []).length ? `<ul>${g.garantias.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="mini">Sem garantias pessoais identificadas.</div>'}</div>
    </div>`;
  }

  // 5) Plano: esta semana → se o banco não entregar → se não houver acordo
  const passos = [
    ...(g.esta_semana || []).map(x => ({ quando: 'Esta semana', acao: x.acao.replace(/\s*\(confirmar com o advogado antes\)/, ''), porque: x.porque })),
    ...(g.caminhos || []).slice(1).map(c => ({ quando: c.quando, acao: c.nome, porque: [...(c.como || []), c.custo_risco].filter(Boolean).join(' ') }))
  ];
  const cartas = (g.caminhos || [])[0];
  if (passos.length) h += `<h4>Plano</h4><div class="plano">${passos.map(x => `<div><div><div class="quando">${esc(x.quando)}</div><div class="passo">${esc(x.acao)}</div><div class="mini">${esc(x.porque)}</div></div></div>`).join('')}</div>`;

  // 6) Cartas para negociar + não prometer
  const naoPrometer = (g.nao_e_abuso || []);
  if ((cartas && (cartas.como || []).length) || naoPrometer.length) {
    h += `<div class="duas" style="margin-top:14px">
      ${cartas && (cartas.como || []).length ? `<div class="cartas"><div class="rot">Cartas para a negociação</div><ul>${cartas.como.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="mini">${esc(cartas.custo_risco || '')}</div></div>` : '<div></div>'}
      ${naoPrometer.length ? `<div class="nao"><div class="rot">Não prometer ao cliente</div><ul>${naoPrometer.map(x => `<li><b>${esc(x.titulo)}:</b> ${esc(x.porque)}</li>`).join('')}</ul></div>` : '<div></div>'}
    </div>`;
  }

  // 7) Documentos + mensagem pronta
  h += `<h4>Documentos e mensagem ao cliente</h4><div class="duas">
    <div class="docs">${(g.documentos || []).map(x => `<label><input type="checkbox" class="no-print"><span><b>${esc(x.doc)}</b> <span class="mini">— ${esc(x.onde)}. Destrava: ${esc(x.destrava)}</span></span></label>`).join('')}</div>
    <div><div class="msg" id="${esc(idMsg)}">${esc(g.mensagem_cliente || '')}</div>
      <button type="button" class="btn btn-sm btn-outline no-print" style="margin-top:6px" onclick="navigator.clipboard.writeText(document.getElementById('${esc(idMsg)}').textContent).then(() => { this.textContent = 'Copiado ✓'; }).catch(() => { this.textContent = 'Selecione e copie'; })">Copiar mensagem</button></div>
  </div>`;

  const cdcNoNao = naoPrometer.some(x => /Consumidor/.test(x.titulo));
  h += `<div class="rodape">${esc(g.nota || '')}${g.estrutura?.cdc?.motivo && !cdcNoNao ? ` · ${esc(g.estrutura.cdc.motivo)}` : ''}</div></div>`;
  return h;
}

// Página inteira para o PDF interno (imprimir): tudo aberto, com tarja
function paginaImpressao(fragmento, titulo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo || 'Diagnóstico interno')}</title>
<style>@page{size:A4;margin:12mm}body{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;margin:0;color:#0f172a}</style></head><body>
<div style="border:2px solid #dc2626;color:#991b1b;font-weight:800;padding:8px 12px;border-radius:8px;margin-bottom:10px">USO INTERNO — Recobro / Balladão Advogados. Não enviar ao cliente.</div>
<h2 style="margin:0 0 2px">${esc(titulo || 'Diagnóstico estratégico')}</h2><div style="font-size:12px;color:#64748b;margin-bottom:12px">Gerado em ${esc(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</div>
${String(fragmento).replace(/<details class="arg"/g, '<details open class="arg"')}</body></html>`;
}

module.exports = { renderizar, paginaImpressao };
