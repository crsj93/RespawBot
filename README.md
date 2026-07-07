# 🤖 Bot de Gerenciamento de Respawns

Bot de Discord feito com **discord.js v14** para gerenciar claims de respawns com sistema de fila automática.

## ✨ Funcionalidades

- `/claim [respawn]` — Reivindica um respawn por **1h30**. Se ocupado, entra na fila automaticamente.
- `/cancelar [respawn]` — Cancela seu claim atual ou remove você da fila de espera.
- **Fila automática** — Quando o tempo acaba ou alguém cancela, o próximo da fila assume instantaneamente.
- **Embeds dinâmicos** — A mensagem do respawn é editada em tempo real mostrando quem está na fila.

## 🚀 Como Configurar

### 1. Criar o bot no Discord Developer Portal

1. Acesse [discord.com/developers/applications](https://discord.com/developers/applications)
2. Clique em **New Application** e dê um nome ao bot
3. Vá em **Bot** → copie o **Token**
4. Vá em **OAuth2** → copie o **Client ID**
5. Em **Bot**, ative as permissões necessárias (Send Messages, Embed Links)

### 2. Configurar as variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com seus dados:

```env
DISCORD_TOKEN=seu_token_aqui
CLIENT_ID=id_da_aplicacao_aqui
GUILD_ID=id_do_servidor_aqui
```

### 3. Personalizar o bot

Abra `index.js` e edite as configurações no topo:

```js
// Adicione ou remova os respawns conforme necessário
const RESPAWNS_VALIDOS = ['Respawn A', 'Respawn B', 'Respawn C'];

// Cole os IDs dos cargos que podem usar os comandos (deixe [] para todos)
const CARGOS_PERMITIDOS = ['ID_DO_CARGO_AQUI'];
```

> **Atenção:** Atualize também as opções de `RESPAWNS_VALIDOS` em `deploy-commands.js` para que o autocompletar do slash command funcione corretamente.

### 4. Instalar dependências

```bash
npm install
```

### 5. Registrar os Slash Commands

Execute **uma vez** para registrar os comandos no servidor:

```bash
npm run deploy
```

### 6. Iniciar o bot

```bash
npm start
```

## 📁 Estrutura do Projeto

```
discord-bot/
├── index.js            # Código principal do bot e lógica de filas
├── deploy-commands.js  # Registra os slash commands na API do Discord
├── package.json
├── .env.example        # Modelo das variáveis de ambiente
└── README.md
```

## ⚙️ Como Funciona a Fila

```
Usuário usa /claim Respawn A
│
├─ Respawn LIVRE  → Inicia claim de 1h30 + envia Embed
│
└─ Respawn OCUPADO → Adiciona ao final da fila + edita Embed
                        │
                        └─ Após 1h30 (ou /cancelar)
                              │
                              ├─ Fila com usuários → Próximo assume automaticamente
                              │
                              └─ Fila vazia → Respawn fica livre
```
