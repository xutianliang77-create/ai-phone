import argparse
import json
from pathlib import Path
import wave

import numpy as np
from voxcpm import VoxCPM


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model = VoxCPM.from_pretrained(args.model_dir, load_denoiser=False)
    sample_rate = int(model.tts_model.sample_rate)

    for preset in manifest["presets"]:
        output = output_dir / f'{preset["referenceAudioId"]}.wav'
        if output.exists() and not args.force:
            print(f"skip {preset['id']}: {output}")
            continue
        prompt = sanitize_prompt(preset["designPrompt"])
        text = f"({prompt}){preset['referenceText']}"
        audio = model.generate(
            text=text,
            cfg_value=float(preset.get("designCfgValue", 2.0)),
            inference_timesteps=int(preset.get("designInferenceTimesteps", 10)),
            retry_badcase=True,
            retry_badcase_max_times=3,
            retry_badcase_ratio_threshold=6.0,
        )
        write_pcm16(output, audio, sample_rate)
        print(f"generated {preset['id']}: {output}")


def sanitize_prompt(value: str) -> str:
    return value.replace("(", "").replace(")", "").strip()


def write_pcm16(path: Path, audio, sample_rate: int) -> None:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0.95:
        samples = samples * (0.95 / peak)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
