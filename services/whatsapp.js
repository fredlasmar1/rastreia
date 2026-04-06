const axios = require('axios');

async function enviarMensagem(numero, mensagem) {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return;
  const numeroLimpo = numero.replace(/\D/g, '');
  const numeroFinal = numeroLimpo.startsWith('55') ? numeroLimpo : `55${numeroLimpo}`;
  try {
    await axios.post(
      `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`,
      { number: numeroFinal, text: mensagem },
      { headers: { apikey: process.env.EVOLUTION_API_KEY }, timeout: 10000 }
    );
  } catch (e) {
    console.error('Erro WhatsApp:', e.message);
  }
}

async function notificarClienteConcluido(pedido, urlRelatorio) {
  if (!pedido.cliente_whatsapp) return;
  const msg = `✅ *RASTREIA - Dossiê Concluído*\n\nOlá, ${pedido.cliente_nome}!\n\nSeu relatório está pronto.\n📄 Protocolo: #${pedido.numero}\n📋 Consulta: ${pedido.alvo_nome}\n\n🔗 Acesse aqui: ${process.env.BASE_URL}${urlRelatorio}\n\n_Recobro Recuperação de Crédito | Anápolis-GO_`;
  await enviarMensagem(pedido.cliente_whatsapp, msg);
}

async function notificarOperadorNovoPedido(pedido) {
  const operadorWpp = process.env.WHATSAPP_OPERADOR;
  if (!operadorWpp) return;
  const msg = `🔔 *RASTREIA - Novo Pedido*\n\n📋 Tipo: ${pedido.tipo}\n👤 Alvo: ${pedido.alvo_nome}\n📄 Doc: ${pedido.alvo_documento}\n💰 Valor: R$ ${pedido.valor}\n⏰ Prazo: 2 horas\n\nAcesse o sistema para iniciar.`;
  await enviarMensagem(operadorWpp, msg);
}

module.exports = { enviarMensagem, notificarClienteConcluido, notificarOperadorNovoPedido };
