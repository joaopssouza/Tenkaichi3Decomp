# Auto-Hospedagem (Self-Hosted) - Tenkaichi 3 Web & Netplay

Esta configuração permite hospedar o port WebAssembly de Dragon Ball Z Budokai Tenkaichi 3 em seu próprio servidor Linux ou máquina local com Docker, eliminando a dependência de Cloudflare Workers ou Durable Objects pagos.

---

## 🚀 Como Iniciar

### 1. Iniciar os Serviços Básicos (Web + Sinalização)
```bash
docker compose up -d --build
```
O jogo estará acessível em:
- **Cliente Web:** `http://localhost:8080/`
- **Servidor de Sinalização (WebSocket):** `ws://localhost:8080/net/ws` (via reverse proxy Nginx)
- **Status do Matchmaking:** `http://localhost:8080/health`

### 2. Expor para a Internet via Cloudflare Tunnel (Sem abrir portas no roteador)
1. Crie um Túnel no [Painel do Cloudflare Zero Trust](https://one.dash.cloudflare.com/) (Networks &rarr; Tunnels).
2. Configure o Public Hostname apontando para `http://web:80` (dentro da rede do Docker) ou `http://localhost:8080`.
3. Adicione o seu `TUNNEL_TOKEN` no arquivo `.env` (ou copie de `docker/.env.example`).
4. Inicie com o perfil de túnel ativado:
```bash
docker compose --profile tunnel up -d
```
Seu jogo e o servidor de sinalização estarão disponíveis publicamente via HTTPS e WSS sem custos de Workers.

---

## 📦 Estrutura dos Serviços

| Container | Função | Porta Interna | Porta Exposta |
|-----------|--------|---------------|---------------|
| `bt3-signaling` | Servidor Node.js para matchmaking, salas WebRTC e relay binário | 3000 | 3000 (opcional) |
| `bt3-game-client` | Nginx com headers COOP/COEP e suporte a Range Requests (`206`) | 80 | 8080 |
| `bt3-cloudflared` | Daemon oficial do Cloudflare Tunnel | - | - |

---

## 🎮 Assets do Jogo & Lazy Loading
- O arquivo `DBZ3_SLUS_21678.ISO` é montado automaticamente como `/disc.iso`.
- O Nginx responde com `206 Partial Content` às requisições do navegador, permitindo que o jogo leia apenas os arquivos necessários sem consumir toda a memória ou requerer download completo na inicialização.
- Para fatiar a ISO em pedaços imutáveis de 1 MiB (`/disc/*.bin`), utilize:
  ```bash
  python port/tools/prep_web_assets.py --iso DBZ3_SLUS_21678.ISO --out port/build/web
  ```
