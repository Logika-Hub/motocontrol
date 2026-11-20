# Vídeo de apresentação do MotoControl

Vídeo de divulgação (16:9, 1920×1080, ~81 s) com narração e legendas, montado com **telas reais do sistema**. Os arquivos gerados (vídeo, áudio, capturas) ficam fora do Git; aqui estão as fontes para refazê-lo quando o sistema ou o texto mudar.

| Arquivo | Função |
|---|---|
| `roteiro.json` | Texto da narração, cena por cena. **Edite aqui** para mudar o que é dito (cada fala vira uma legenda) |
| `video.html` | As cenas animadas (títulos, telas com zoom e destaque, legendas). Os tempos vêm da narração |
| `capturar-telas.js` | Tira as capturas do sistema em 16:9 para `shots/` |
| `coordenadas.js` | Mede onde ficam os elementos destacados nas telas (`rects.json`) |
| `narrar.py` | Gera a narração (uma fala por arquivo) e a linha do tempo `timeline.json` |
| `mixar_audio.py` | Junta narração e fundo musical suave (sintetizado, sem direitos autorais) em `trilha.wav` |
| `render.js` | Desenha o vídeo quadro a quadro e codifica o MP4 |
| `gerar_srt.py` | Legendas separadas (`.srt`) para YouTube, Instagram etc. |

## Refazer o vídeo

Pré-requisitos: Node.js com Playwright, `ffmpeg`, Python 3 e o sintetizador de voz [Piper](https://github.com/OHF-Voice/piper1-gpl) (`pip install piper-tts`) com a voz `pt_BR-faber-medium` (Hugging Face, `rhasspy/piper-voices`, licença dos dados CC0).

Com o MotoControl rodando com os dados de demonstração (`npm run seed:demo` e `npm start`), dentro desta pasta:

```bash
node capturar-telas.js shots ../../docs/manual/imagens
```
```bash
node coordenadas.js > rects.json
```
```bash
python3 narrar.py roteiro.json /caminho/pt_BR-faber-medium.onnx .
```
```bash
python3 mixar_audio.py && python3 gerar_srt.py
```
```bash
node render.js video MotoControl-apresentacao.mp4 trilha.wav
```

Para conferir quadros soltos antes de renderizar tudo: `node render.js preview 5,26,50` (gera PNGs em `preview/`).

### Trocar a voz

Para usar outra voz (por exemplo, uma voz profissional gravada ou gerada em outro serviço), substitua os arquivos `audio/NN_MM.wav` — um por fala, na ordem do roteiro — e rode `python3 narrar.py roteiro.json - . --sem-sintese`. Os tempos das cenas e das legendas são recalculados pela duração real dos novos áudios; depois, repita a mixagem e a renderização.
