// ============================================================
// BOT DE DISCORD - GERENCIADOR DE CLAIMS DE RESPAWN
// Usa discord.js v14 com Slash Commands e sistema de filas
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

// ============================================================
// CONFIGURAÇÕES INICIAIS — edite aqui conforme necessário
// ============================================================

// Lista de respawns válidos que podem ser reivindicados
const RESPAWNS_VALIDOS = ['Podzila Quaras', 'Podzilla Rootthings -1', 'Podzilla Rootthings -2', 'Ingol Surface', 'Ingol -2', 'Ingol -3'];

// IDs dos cargos que têm permissão para usar os comandos
// Deixe o array vazio [] para permitir qualquer pessoa
const CARGOS_PERMITIDOS = [
   '1447236863826985073'
];

// Duração de cada claim em milissegundos (1 hora e 30 minutos)
const DURACAO_CLAIM_MS = 90 * 60 * 1000; // 5.400.000 ms

// ============================================================
// ESTRUTURA DE DADOS DOS RESPAWNS
// Cada respawn possui:
//   currentUser  — usuário que está no claim agora (ou null)
//   queue        — Array com os usuários na fila de espera
//   timer        — referência do setTimeout para cancelar se necessário
//   messageId    — ID da mensagem Embed para edição posterior
//   channelId    — canal onde a mensagem foi enviada
//   dataInicio   — quando o claim atual começou
//   lock         — mutex simples (boolean) para evitar race conditions
// ============================================================
const respawnState = new Map();

// Inicializa o estado de cada respawn com valores vazios
for (const respawn of RESPAWNS_VALIDOS) {
  respawnState.set(respawn, {
    currentUser: null,
    queue: [],
    timer: null,
    messageId: null,
    channelId: null,
    dataInicio: null,
    lock: false, // mutex para tornar a aquisição de claim atômica
  });
}

// ============================================================
// CLIENTE DISCORD
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

/**
 * Verifica se o membro possui um dos cargos permitidos.
 * Se CARGOS_PERMITIDOS estiver vazio, qualquer um pode usar.
 * Aceita tanto membros cacheados quanto não-cacheados (formato da API).
 */
function temPermissao(member) {
  if (CARGOS_PERMITIDOS.length === 0) return true;

  // member.roles pode ser um GuildMemberRoleManager (cacheado) ou
  // um objeto simples { cache, ... } vindo de interações não-cacheadas.
  // Usamos member.roles?.cache (Map) se disponível; caso contrário,
  // tentamos member.roles como iterável direto.
  const roles = member?.roles?.cache ?? member?.roles;
  if (!roles) return false;

  // Suporte a Map (cacheado) e Array/Set (API object)
  if (typeof roles.some === 'function') {
    return roles.some((role) => CARGOS_PERMITIDOS.includes(role.id ?? role));
  }
  if (roles instanceof Map) {
    for (const [id] of roles) {
      if (CARGOS_PERMITIDOS.includes(id)) return true;
    }
  }
  return false;
}

/**
 * Monta o Embed que representa o status atual de um respawn.
 * Exibe o ocupante atual, o tempo restante estimado e a fila de espera.
 */
function buildEmbedStatus(respawn, state) {
  const embed = new EmbedBuilder()
    .setTitle(`🏴 Respawn: ${respawn}`)
    .setColor(state.currentUser ? 0xe74c3c : 0x2ecc71) // vermelho = ocupado, verde = livre
    .setTimestamp();

  if (state.currentUser) {
    const expiracao = state.dataInicio
      ? new Date(state.dataInicio.getTime() + DURACAO_CLAIM_MS)
      : null;

    embed.addFields(
      {
        name: '👤 Ocupado por',
        value: `<@${state.currentUser.id}>`,
        inline: true,
      },
      {
        name: '⏰ Expira em',
        value: expiracao
          ? `<t:${Math.floor(expiracao.getTime() / 1000)}:R>`
          : 'N/A',
        inline: true,
      }
    );
  } else {
    embed.addFields({ name: '✅ Status', value: 'Respawn **LIVRE**', inline: false });
  }

  // Monta a lista da fila de espera
  if (state.queue.length === 0) {
    embed.addFields({ name: '📋 Fila de Espera', value: 'Vazia', inline: false });
  } else {
    const listaFila = state.queue
      .map((u, i) => `**${i + 1}º** — <@${u.id}>`)
      .join('\n');
    embed.addFields({ name: '📋 Fila de Espera', value: listaFila, inline: false });
  }

  return embed;
}

/**
 * Envia um novo painel Embed para o canal e salva as referências no state.
 * Chamado na primeira vez ou quando o painel antigo foi deletado.
 */
async function enviarNovoEmbed(respawn, state, canal) {
  const embed = buildEmbedStatus(respawn, state);
  const msgEnviada = await canal.send({ embeds: [embed] });
  state.messageId = msgEnviada.id;
  state.channelId = canal.id;
}

/**
 * Atualiza a mensagem Embed existente com o status mais recente do respawn.
 * Se a mensagem tiver sido deletada, cria um novo painel no canal informado.
 *
 * @param {string} respawn
 * @param {object} state
 * @param {TextChannel|null} canalFallback — usado para recriar o painel se necessário
 */
async function atualizarEmbed(respawn, state, canalFallback = null) {
  if (!state.messageId || !state.channelId) {
    // Sem referência de painel: tenta criar no canal de fallback
    if (canalFallback) await enviarNovoEmbed(respawn, state, canalFallback);
    return;
  }

  try {
    const canal = await client.channels.fetch(state.channelId);
    const mensagem = await canal.messages.fetch(state.messageId);
    const embedAtualizado = buildEmbedStatus(respawn, state);
    await mensagem.edit({ embeds: [embedAtualizado] });
  } catch {
    // Mensagem ou canal não encontrado — invalida as referências antigas e
    // recria o painel para que o status continue visível.
    state.messageId = null;
    state.channelId = null;
    if (canalFallback) {
      await enviarNovoEmbed(respawn, state, canalFallback);
    }
  }
}

/**
 * Inicia o claim de um respawn para um usuário específico.
 * Define o estado de forma SÍNCRONA antes de qualquer I/O, tornando
 * a aquisição atômica dentro do event loop do Node.js.
 *
 * @param {string}      respawn    — nome do respawn
 * @param {User}        usuario    — objeto User do Discord
 * @param {TextChannel} canal      — canal onde a mensagem será enviada
 * @param {boolean}     isTransicao — true se veio de uma transição automática da fila
 */
async function iniciarClaim(respawn, usuario, canal, isTransicao = false) {
  const state = respawnState.get(respawn);

  // ── Atualização SÍNCRONA do estado ────────────────────────
  // Feito antes de qualquer await, garantindo que outra interação
  // simultânea já veja o respawn como ocupado ao verificar state.currentUser.
  state.currentUser = usuario;
  state.dataInicio = new Date();
  if (state.timer) clearTimeout(state.timer);

  // ── Agenda a expiração automática (1h30) ──────────────────
  state.timer = setTimeout(() => expirarClaim(respawn, canal), DURACAO_CLAIM_MS);

  // ── Atualiza ou cria o painel Embed ───────────────────────
  if (isTransicao) {
    // Em transições da fila, reaproveita o painel existente (ou recria se perdido)
    await atualizarEmbed(respawn, state, canal);
  } else {
    // Primeira vez: envia um novo painel
    await enviarNovoEmbed(respawn, state, canal);
  }

  // ── Notificação pública ───────────────────────────────────
  const prefixo = isTransicao ? '🔄 **Próximo da fila!**' : '🟢 **Claim iniciado!**';
  await canal.send(
    `${prefixo} <@${usuario.id}> agora tem o **${respawn}** por 1h30. ⏱️`
  );
}

/**
 * Expira o claim atual de um respawn (chamado pelo timer ou por /cancelar).
 * Se houver fila, o próximo assume automaticamente; caso contrário, libera.
 */
async function expirarClaim(respawn, canal) {
  const state = respawnState.get(respawn);

  // ── Limpa o estado do ocupante de forma SÍNCRONA ─────────
  state.currentUser = null;
  state.dataInicio = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (state.queue.length > 0) {
    // ── Transição automática: próximo da fila assume ──────────
    const proximo = state.queue.shift();
    await iniciarClaim(respawn, proximo, canal, true);
  } else {
    // ── Fila vazia: respawn fica livre ────────────────────────
    await atualizarEmbed(respawn, state, canal);
    await canal.send(`✅ O **${respawn}** agora está **livre**! Use \`/claim\` para reivindicá-lo.`);
  }
}

// ============================================================
// HANDLER DE INTERAÇÕES (Slash Commands)
// ============================================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, channel } = interaction;

  // ── Verificação de permissão ──────────────────────────────
  if (!temPermissao(member)) {
    return interaction.reply({
      content: '❌ Você não tem permissão para usar este comando.',
      ephemeral: true,
    });
  }

  // ── Captura e valida o respawn escolhido ──────────────────
  const respawn = interaction.options.getString('respawn');
  if (!RESPAWNS_VALIDOS.includes(respawn)) {
    return interaction.reply({
      content: `❌ Respawn inválido. Opções disponíveis: ${RESPAWNS_VALIDOS.join(', ')}`,
      ephemeral: true,
    });
  }

  // ==========================================================
  // COMANDO /claim
  // ==========================================================
  if (commandName === 'claim') {
    const state = respawnState.get(respawn);
    const usuario = interaction.user;

    // Impede o usuário de entrar duas vezes no mesmo respawn
    if (state.currentUser?.id === usuario.id) {
      return interaction.reply({
        content: `⚠️ Você já está com o **${respawn}** em seu poder!`,
        ephemeral: true,
      });
    }
    if (state.queue.some((u) => u.id === usuario.id)) {
      return interaction.reply({
        content: `⚠️ Você já está na fila de espera do **${respawn}**!`,
        ephemeral: true,
      });
    }

    // ── Mutex: protege a decisão livre/ocupado ────────────────
    // state.lock é verificado e setado de forma SÍNCRONA antes de
    // qualquer await, evitando que dois claims simultâneos ganhem o respawn.
    if (!state.currentUser && !state.lock) {
      // ── Respawn LIVRE: adquire o lock e inicia o claim ───────
      state.lock = true;
      try {
        await interaction.reply({
          content: `✅ **${respawn}** estava livre! Iniciando seu claim...`,
          ephemeral: true,
        });
        await iniciarClaim(respawn, usuario, channel);
      } finally {
        state.lock = false;
      }
    } else {
      // ── Respawn OCUPADO (ou em disputa): entra na fila ───────
      state.queue.push(usuario);
      const posicao = state.queue.length;
      await interaction.reply({
        content: `🕐 O **${respawn}** está ocupado. Você entrou como **${posicao}º da fila**!`,
        ephemeral: true,
      });
      await atualizarEmbed(respawn, state, channel);
    }
  }

  // ==========================================================
  // COMANDO /cancelar
  // ==========================================================
  else if (commandName === 'cancelar') {
    const state = respawnState.get(respawn);
    const usuario = interaction.user;

    if (state.currentUser?.id === usuario.id) {
      // ── Usuário atual cancela: libera e passa para o próximo ──
      await interaction.reply({
        content: `🚫 Você cancelou seu claim no **${respawn}**. Passando para o próximo...`,
        ephemeral: true,
      });
      await expirarClaim(respawn, channel);
    } else {
      // ── Usuário está na fila: remove da fila ─────────────────
      const indice = state.queue.findIndex((u) => u.id === usuario.id);
      if (indice === -1) {
        return interaction.reply({
          content: `❌ Você não possui nenhum claim ou posição na fila do **${respawn}**.`,
          ephemeral: true,
        });
      }

      state.queue.splice(indice, 1);
      await interaction.reply({
        content: `✅ Você foi removido da fila do **${respawn}**.`,
        ephemeral: true,
      });
      await atualizarEmbed(respawn, state, channel);
    }
  }
});

// ============================================================
// EVENTO READY
// ============================================================
client.once('ready', () => {
  console.log(`✅ Bot online como: ${client.user.tag}`);
  console.log(`📍 Respawns configurados: ${RESPAWNS_VALIDOS.join(', ')}`);
});

// ============================================================
// LOGIN
// ============================================================
client.login(process.env.DISCORD_TOKEN);
