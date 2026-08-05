from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 48_000
DURATION_SECONDS = 60
CHANNELS = 2
FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS

CHORDS = (
    (130.81, 164.81, 196.00),
    (110.00, 146.83, 174.61),
    (98.00, 130.81, 164.81),
    (116.54, 146.83, 196.00),
)
BELL_NOTES = (523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.00, 698.46)


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def render_sample(time_seconds: float, channel: int) -> float:
    chord = CHORDS[int(time_seconds // 8) % len(CHORDS)]
    stereo_phase = 0.14 if channel == 0 else -0.14
    stereo_detune = 0.9985 if channel == 0 else 1.0015

    pad = 0.0
    for index, frequency in enumerate(chord):
        amplitude = (0.075, 0.055, 0.045)[index]
        drift = math.sin(2.0 * math.pi * (0.021 + index * 0.008) * time_seconds + stereo_phase)
        pad += amplitude * math.sin(
            2.0 * math.pi * frequency * stereo_detune * time_seconds
            + stereo_phase * (index + 1)
            + drift * 0.42
        )

    bell_index = int(time_seconds // 4)
    bell_local = time_seconds - bell_index * 4.0
    bell_envelope = math.exp(-1.65 * bell_local)
    bell_frequency = BELL_NOTES[bell_index % len(BELL_NOTES)]
    bell = bell_envelope * (
        0.075 * math.sin(2.0 * math.pi * bell_frequency * time_seconds + stereo_phase)
        + 0.034 * math.sin(2.0 * math.pi * bell_frequency * 2.01 * time_seconds)
        + 0.016 * math.sin(2.0 * math.pi * bell_frequency * 3.99 * time_seconds - stereo_phase)
    )

    pulse_gain = smoothstep((time_seconds - 8.0) / 5.0) * (1.0 - smoothstep((time_seconds - 56.0) / 4.0))
    pulse_phase = time_seconds % 1.0
    pulse_envelope = math.exp(-7.0 * pulse_phase)
    pulse = 0.075 * pulse_gain * pulse_envelope * math.sin(2.0 * math.pi * 55.0 * time_seconds)

    shimmer = 0.016 * math.sin(2.0 * math.pi * 0.07 * time_seconds + stereo_phase) * math.sin(
        2.0 * math.pi * 880.0 * stereo_detune * time_seconds
    )
    texture = 0.008 * math.sin(2.0 * math.pi * 0.13 * time_seconds) * math.sin(
        2.0 * math.pi * (231.0 + 7.0 * math.sin(time_seconds * 0.11)) * time_seconds
    )

    fade_in = smoothstep(time_seconds / 2.0)
    fade_out = 1.0 - smoothstep((time_seconds - 57.0) / 3.0)
    sample = (pad + bell + pulse + shimmer + texture) * fade_in * fade_out
    return max(-0.82, min(0.82, sample))


def main() -> None:
    random.seed(20260724)
    output = Path(__file__).resolve().parent.parent / "audio" / "dream-ambient.wav"
    output.parent.mkdir(parents=True, exist_ok=True)

    with wave.open(str(output), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)

        block = bytearray()
        for frame in range(FRAME_COUNT):
            time_seconds = frame / SAMPLE_RATE
            for channel in range(CHANNELS):
                value = int(render_sample(time_seconds, channel) * 32767.0)
                block.extend(struct.pack("<h", value))
            if len(block) >= 262_144:
                wav_file.writeframesraw(block)
                block.clear()
        if block:
            wav_file.writeframesraw(block)

    print(output)


if __name__ == "__main__":
    main()
