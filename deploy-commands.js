// ============================================================
// DEPLOY DE SLASH COMMANDS
// Execute este arquivo UMA VEZ para registrar os comandos
// no servidor Discord:  node deploy-commands.js
// ============================================================

const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

// Importa a lista de respawns válidos para gerar as opções dinamicamente
const RESPAWNS_VALIDOS = ['Podzila Quaras', 'Podzilla Rootthings -1', 'Podzilla Rootthings -2', 'Ingol Surface', 'Ingol -2', 'Ingol -3'];

// Monta as opções de escolha a partir do array de respawns
const opcoesRespawn = RESPAWNS_VALIDOS.map((r) => ({ name: r, value: r }));

// ── Definição dos comandos ────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Reivindica um respawn ou entra na fila de espera')
    .addStringOption((option) =>
      option
        .setName('respawn')
        .setDescription('Qual respawn você quer reivindicar?')
        .setRequired(true)
        .addChoices(...opcoesRespawn)
    ),

  new SlashCommandBuilder()
    .setName('cancelar')
    .setDescription('Cancela seu claim atual ou remove você da fila de espera')
    .addStringOption((option) =>
      option
        .setName('respawn')
        .setDescription('Qual respawn você quer cancelar?')
        .setRequired(true)
        .addChoices(...opcoesRespawn)
    ),
].map((command) => command.toJSON());

// ── Registro via API REST do Discord ─────────────────────────
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Registrando slash commands...');

    await rest.put(
      // Use Routes.applicationGuildCommands para registro instantâneo em um servidor específico
      // Use Routes.applicationCommands para registro global (leva até 1 hora para propagar)
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Slash commands registrados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
})();
