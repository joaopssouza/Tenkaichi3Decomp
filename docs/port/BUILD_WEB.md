# WebAssembly Build Instructions (Emscripten)

Este documento descreve os comandos e a imagem Docker exata utilizada para compilar o port WebAssembly (JSPI e Asyncify).

## Versão do Emscripten (Fixada)

O build do repositório utiliza a seguinte versão do SDK Emscripten:

- **Imagem Docker**: `emscripten/emsdk:6.0.12`
- **Versão do Compilador**: `emcc 6.0.12 (5488e0871d46d19a3209988190fa6a653126256f)`
- **Clang Base**: `clang version 24.0.0git (https://github.com/llvm/llvm-project 55ea1f4ebea23d0355d5cdb075f1e12f28ab82d0)`
- **Release Hash no SDK**: `6e9f6885cb17a3d6c8fd488a5cff730f50aba61d`

Para verificar a versão dentro do container:
```bash
docker run --rm emscripten/emsdk:6.0.12 emcc --version
```

---

## Comandos Exatos de Build

Execute a partir da raiz do repositório:

### 1. Compilação dos objetos e reescrita de LLVM IR
Compila todos os fontes do jogo, aplica shims de soft-float e gera a tabela de objetos:
```bash
docker run --rm -v "$(pwd)":/src emscripten/emsdk:6.0.12 python3 port/web/build.py
```

### 2. Link do alvo Web JSPI (`bt3-jspi`)
Gera os artefatos WebAssembly JSPI em `port/build/web/bt3-jspi.js` e `port/build/web/bt3-jspi.wasm` (para Chrome, Edge e navegadores compatíveis):
```bash
docker run --rm -v "$(pwd)":/src emscripten/emsdk:6.0.12 python3 port/web/link.py web
```

### 3. Link do alvo Web Asyncify (`bt3-async`)
Gera os artefatos WebAssembly Asyncify em `port/build/web/bt3-async.js` e `port/build/web/bt3-async.wasm` (para Safari e dispositivos iOS):
```bash
docker run --rm -v "$(pwd)":/src emscripten/emsdk:6.0.12 python3 port/web/link.py webasync
```

---

## Build Completo em Linha de Comando Única

Para executar o pipeline completo sequencialmente:
```bash
docker run --rm -v "$(pwd)":/src emscripten/emsdk:6.0.12 sh -c "python3 port/web/build.py && python3 port/web/link.py web && python3 port/web/link.py webasync"
```
