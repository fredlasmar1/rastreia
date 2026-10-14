/**
 * CPF/CNPJ — inclusive o CNPJ alfanumérico (IN RFB 2.229/2024, desde 07/2026).
 *   node scripts/test-documento.js
 */
const assert = require('assert');
const D = require('../services/documento');
let ok = 0, falhas = 0;
const teste = (n, fn) => { try { fn(); ok++; console.log('  ✔', n); } catch (e) { falhas++; console.log('  ✘', n, '\n     ', e.message); } };

teste('Exemplo oficial da Receita 12.ABC.345/01DE-35 é válido', () => {
  assert.ok(D.validarCNPJ('12.ABC.345/01DE-35'));
  assert.strictEqual(D.limparDoc('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.strictEqual(D.formatarDoc('12ABC34501DE35'), '12.ABC.345/01DE-35');
  assert.strictEqual(D.tipoDoc('12.ABC.345/01DE-35'), 'PJ');
});
teste('Trocar uma letra invalida o DV', () => assert.ok(!D.validarCNPJ('12.ABD.345/01DE-35')));
teste('CNPJ numérico antigo continua válido', () => {
  assert.ok(D.validarCNPJ('59.285.411/0001-13')); assert.ok(D.validarCNPJ('00.000.000/0001-91'));
  assert.strictEqual(D.formatarDoc('59285411000113'), '59.285.411/0001-13');
});
teste('CPF', () => {
  assert.ok(D.validarCPF('111.444.777-35')); assert.ok(!D.validarCPF('111.444.777-36')); assert.ok(!D.validarCPF('111.111.111-11'));
  assert.strictEqual(D.tipoDoc('111.444.777-35'), 'PF'); assert.strictEqual(D.formatarDoc('11144477735'), '111.444.777-35');
});
teste('Rótulo grudado não vira CNPJ falso ("CPF: ..." / "CNPJ ...")', () => {
  assert.strictEqual(D.limparDoc('CPF: 111.444.777-35'), '11144477735');
  assert.strictEqual(D.limparDoc('CNPJ 59.285.411/0001-13'), '59285411000113');
});
teste('Raiz do CNPJ (8 posições) com letras', () => assert.strictEqual(D.raizCNPJ('12.ABC.345/01DE-35'), '12ABC345'));

console.log(`\n${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
