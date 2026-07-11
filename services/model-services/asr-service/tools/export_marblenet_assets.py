import argparse
from pathlib import Path

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--onnx", required=True)
    parser.add_argument("--assets", required=True)
    args = parser.parse_args()

    from nemo.collections.asr.models import EncDecFrameClassificationModel
    from nemo.core import typecheck

    typecheck.set_typecheck_enabled(False)
    model = EncDecFrameClassificationModel.restore_from(
        args.model,
        strict=False,
        map_location="cpu",
    )
    model.eval()
    onnx_path = Path(args.onnx)
    assets_path = Path(args.assets)
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    if not onnx_path.is_file():
        model.export(str(onnx_path))

    featurizer = model.preprocessor.featurizer
    np.savez(
        assets_path,
        window=featurizer.window.detach().cpu().numpy().astype(np.float32),
        filterbank=featurizer.fb.detach().cpu().numpy().astype(np.float32),
        n_fft=np.int64(featurizer.n_fft),
        hop_length=np.int64(featurizer.hop_length),
        win_length=np.int64(featurizer.win_length),
        preemph=np.float32(featurizer.preemph),
        log_guard=np.float32(featurizer.log_zero_guard_value),
        pad_to=np.int64(featurizer.pad_to),
    )


if __name__ == "__main__":
    main()
