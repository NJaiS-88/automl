import argparse
import json
import pickle
import sys
from pathlib import Path

import pandas as pd


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--payload-path", required=True)
    args = parser.parse_args()

    # Ensure custom project modules (e.g. dev2_automl_doctor) are importable during unpickling.
    project_root = Path(__file__).resolve().parents[2]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    with open(args.model_path, "rb") as f:
        model = pickle.load(f)
    with open(args.payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    df = pd.DataFrame([payload])
    pred = model.predict(df)
    response = {"prediction": pred.tolist()[0]}

    if hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(df)
            pred_label = response["prediction"]
            class_labels = list(getattr(model, "classes_", []))
            if class_labels and pred_label in class_labels:
                pred_idx = class_labels.index(pred_label)
                response["predicted_probability"] = float(proba[0][pred_idx])
            else:
                response["predicted_probability"] = float(max(proba[0]))
        except Exception:
            pass

    print(json.dumps(response, default=str))


if __name__ == "__main__":
    main()
