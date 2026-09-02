#!/usr/bin/env bash
# Regenerate the voice clips. Needs piper (pip install piper-tts) and ffmpeg.
#
# Models come from sherpa-onnx release assets on GitHub:
#   soft = en_GB-jenny_dioco-medium   warm = en_US-libritts_r-medium speaker 130
# Speaker 130 was chosen by measuring pitch (182 Hz) and jitter across candidates,
# not by ear — an earlier blind pick turned out to be a man.
#
# Two things NOT to add back:
#   - aecho / short reverb. Two-tap delays comb-filter the decay and that is
#     exactly what made the voice sound robotic at the end of words.
#   - aggressive end-trimming. Trim at -62 dB and fade over 200 ms, or the last
#     syllable gets chopped instead of ending.
set -euo pipefail

MODEL_SOFT=${MODEL_SOFT:-models/en_GB-jenny_dioco-medium.onnx}
MODEL_WARM=${MODEL_WARM:-models/en_US-libritts_r-medium.onnx}
CHAIN="silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.02,\
areverse,silenceremove=start_periods=1:start_threshold=-62dB:start_silence=0.12,areverse,\
highpass=f=85,equalizer=f=225:t=q:w=1.0:g=1.8,equalizer=f=7400:t=q:w=1.8:g=-2.4,\
acompressor=threshold=-18dB:ratio=2.2:attack=14:release=240:makeup=1.5,\
loudnorm=I=-15:TP=-2:LRA=9,apad=pad_dur=0.08,afade=t=in:st=0:d=0.015"

render () {                       # render <model> <outdir> [speaker]
  local model=$1 out=$2 spk=${3:-}
  local sp=""; [ -n "$spk" ] && sp="-s $spk"
  mkdir -p "$out"
  declare -A W=(
    [inhale]="Breathe in" [exhale]="And breathe out" [hold]="Hold"
    [top]="A little more" [ready]="Let's begin" [done]="That's it, well done"
  )
  for k in "${!W[@]}"; do
    echo "${W[$k]}" | piper -m "$model" -f "/tmp/raw_$k.wav" \
      --length-scale 1.22 --noise-scale 0.7 --noise-w-scale 0.85 --sentence-silence 0.15 $sp
    ffmpeg -v error -y -i "/tmp/raw_$k.wav" -af "$CHAIN" -ac 1 "/tmp/mid_$k.wav"
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/mid_$k.wav")
    st=$(python3 -c "print(max(0,$dur-0.20))")
    ffmpeg -v error -y -i "/tmp/mid_$k.wav" -af "afade=t=out:st=$st:d=0.20" \
      -ac 1 -ar 22050 -q:a 4 "$out/$k.mp3"
  done
}

render "$MODEL_SOFT" audio/soft
render "$MODEL_WARM" audio/warm 130
echo "Voices rebuilt. Run 'npm test', then check on a phone in a parked car."
