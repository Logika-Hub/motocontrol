"""Mixa a narração (timeline.json) com um fundo musical suave sintetizado -> trilha.wav"""
import json, subprocess
tl = json.load(open('timeline.json'))
D = tl['duracao']
inputs, filters, labels = [], [], []
for i, f in enumerate(tl['falas']):
    inputs += ['-i', f['arquivo']]
    ms = int(f['inicio'] * 1000)
    filters.append(f'[{i}:a]aresample=48000,adelay={ms}|{ms}[v{i}]')
    labels.append(f'[v{i}]')
n = len(tl['falas'])
filters.append(f"{''.join(labels)}amix=inputs={n}:normalize=0,highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,apad=whole_dur={D}[voz]")
notas = [130.81, 164.81, 196.00, 246.94, 329.63]
expr = '+'.join(f'{0.18 if k < 3 else 0.1}*sin(2*PI*{fr}*t)*(0.75+0.25*sin(2*PI*{0.07 + 0.03*k}*t))' for k, fr in enumerate(notas))
filters.append(f"aevalsrc='{expr}':s=48000:d={D},lowpass=f=900,volume=0.11,afade=t=in:d=2.5,afade=t=out:st={D-3.5}:d=3.5,pan=stereo|c0=c0|c1=c0[fundo]")
filters.append("[voz]pan=stereo|c0=c0|c1=c0[voz2]")
filters.append("[voz2][fundo]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]")
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error'] + inputs + ['-filter_complex', ';'.join(filters), '-map', '[out]', '-t', str(D), '-c:a', 'pcm_s16le', 'trilha.wav'], check=True)
print('trilha.wav ok')
