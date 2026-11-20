"""Gera as legendas .srt a partir de timeline.json"""
import json, sys
tl = json.load(open('timeline.json'))
def ts(s):
    ms = int(round(s * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s_, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s_:02d},{ms:03d}'
saida = sys.argv[1] if len(sys.argv) > 1 else 'MotoControl-apresentacao.srt'
blocos = [f"{i}\n{ts(f['inicio'])} --> {ts(f['fim'] + 0.25)}\n{f['texto']}\n" for i, f in enumerate(tl['falas'], 1)]
open(saida, 'w', encoding='utf-8').write('\n'.join(blocos))
print(len(blocos), 'legendas ->', saida)
