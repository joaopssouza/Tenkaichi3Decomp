# Workspace: Projeto Engenharia Reversa

Este workspace está configurado com as seguintes suítes de skills e ferramentas para agentes de IA:

## 1. Superpowers (`.agents/skills/*`)
Metodologia completa de desenvolvimento e engenharia para agentes de código:
- `using-superpowers`: Ativação e regras de uso das skills.
- `brainstorming`: Exploração e especificação antes da implementação.
- `writing-plans` & `executing-plans`: Planejamento detalhado e execução passo a passo.
- `subagent-driven-development` & `dispatching-parallel-agents`: Delegação e orquestração de subagentes.
- `test-driven-development`: Práticas rigorosas de TDD (Red-Green-Refactor).
- `systematic-debugging`: Diagnóstico sistemático de causa-raiz.
- `requesting-code-review` & `receiving-code-review`: Revisão rigorosa de código.
- `verification-before-completion`: Validação de requisitos e integridade antes de concluir tarefas.
- `using-git-worktrees`: Gestão isolada de branches e worktrees.

## 2. REA - Reverse Engineer Anything (`.agents/skills/reverse-engineer-anything`)
Conjunto avançado de engenharia reversa para binários nativos, aplicativos Electron/JavaScript, montagens gerenciadas (.NET), pacotes Android (APK), firmware e capturas de rede/tráfego.
- **Skills**:
  - `reverse-engineer-anything`: Guia operacional para inspecionar, descompilar e analisar artefatos.
  - `rea-tool-design`: Design de ferramentas de investigação e contratos MCP/CLI.
- **Dependência Local**: Pacote `rea-agents` instalado via npm (`node_modules/.bin/rea`).
- **Servidor MCP**: Configurado para execução via `npx -y rea-agents@6.4.0 mcp`.

## 3. Code Review Skill (`.agents/skills/code-review-skill`)
Guia e automações para revisões aprofundadas de arquitetura, segurança, performance e qualidade de código em mais de 25 linguagens e frameworks (React, Vue, Angular, Rust, Python, Django, FastAPI, Go, C#, Java, Swift, Kotlin, Flutter, C/C++, etc.).
- **Referências**: Guias temáticos e cross-cutting em `.agents/skills/code-review-skill/reference/`.
- **Scripts**: Analisador estático de PRs em Python (`.agents/skills/code-review-skill/scripts/pr-analyzer.py`).

---

### Diretrizes de Execução
- Antes de iniciar tarefas complexas de planejamento ou arquitetura, consulte a skill `brainstorming` ou `using-superpowers`.
- Ao conduzir análises de binários, ASAR ou executáveis, consulte a skill `reverse-engineer-anything` e use o CLI `rea` ou as ferramentas MCP do REA.
- Ao conduzir auditorias e revisões de código ou pull requests, consulte a skill `code-review-skill` e os guias na pasta `reference/`.
