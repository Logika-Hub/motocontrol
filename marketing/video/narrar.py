"""Gera um WAV por fala do roteiro e a linha do tempo (cenas, legendas) em timeline.json.

Uso: narrar.py <roteiro.json> <modelo.onnx> <pasta_saida>
Para trocar a voz depois, basta substituir os arquivos audio/NN_MM.wav (mesmos nomes)
e rodar de novo com --sem-sintese: os tempos são recalculados pela duração real dos áudios.
"""
import json, subprocess, sys, os

roteiro, modelo, saida = sys.argv[1:4]
sintetizar = '--sem-sintese' not in sys.argv
python_tts = os.path.join(os.path.dirname(sys.executable), 'python')

ENTRADA_1A_CENA = 1.2   # silêncio antes da primeira fala
ENTRADA = 0.6           # silêncio no início de cada cena
ENTRE_FALAS = 0.3
SAIDA = 0.7             # silêncio no fim de cada cena
SAIDA_FINAL = 3.0

def duracao(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())

os.makedirs(os.path.join(saida, 'audio'), exist_ok=True)
dados = json.load(open(roteiro, encoding='utf-8'))
t = 0.0
cenas, falas = [], []
for i, cena in enumerate(dados['cenas']):
    inicio = t
    t += ENTRADA_1A_CENA if i == 0 else ENTRADA
    for j, texto in enumerate(cena['falas']):
        wav = os.path.join(saida, 'audio', f'{i:02d}_{j:02d}.wav')
        if sintetizar:
            subprocess.run([python_tts, '-m', 'piper', '-m', modelo, '-f', wav, '--length-scale', '1.05'],
                           input=texto, text=True, check=True, capture_output=True)
        d = duracao(wav)
        falas.append({'cena': cena['id'], 'texto': texto, 'arquivo': wav, 'inicio': round(t, 3), 'fim': round(t + d, 3)})
        t += d + (ENTRE_FALAS if j < len(cena['falas']) - 1 else 0)
    t += SAIDA_FINAL if i == len(dados['cenas']) - 1 else SAIDA
    cenas.append({'id': cena['id'], 'inicio': round(inicio, 3), 'fim': round(t, 3)})

json.dump({'duracao': round(t, 3), 'cenas': cenas, 'falas': falas},
          open(os.path.join(saida, 'timeline.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(falas)} falas, {len(cenas)} cenas, duração total {t:.1f}s')
for c in cenas:
    print(f"  {c['id']:<10} {c['inicio']:6.1f} → {c['fim']:6.1f}")
