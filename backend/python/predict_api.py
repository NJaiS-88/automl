import argparse
import json
import pickle

import pandas as pd


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--payload-path", required=True)
    args = parser.parse_args()

    with open(args.model_path, "rb") as f:
        model = pickle.load(f)
    with open(args.payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    df = pd.DataFrame([payload])
    pred = model.predict(df)
    response = {"prediction": pred.tolist()[0]}

    if hasattr(model, "predict_proba"):
        try:
            response["probabilities"] = model.predict_proba(df).tolist()[0]
        except Exception:
            pass

    print(json.dumps(response, default=str))


if __name__ == "__main__":
    main()
