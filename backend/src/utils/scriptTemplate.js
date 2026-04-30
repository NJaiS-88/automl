function buildTrainingScript({ targetCol }) {
  return `import argparse
from dev1_data_pipeline import run_full_pipeline


def main():
    parser = argparse.ArgumentParser(description="Train AutoML pipeline and print report.")
    parser.add_argument("--file-path", required=True, help="Path to your CSV dataset")
    parser.add_argument("--target-col", default="${targetCol}", help="Target column name")
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    report = run_full_pipeline(
        file_path=args.file_path,
        target_col=args.target_col,
        random_state=args.random_state,
    )
    print("Training completed.")
    print("Problem type:", report.get("problem_type"))
    print("Final metrics:", report.get("dev3", {}).get("final_metrics"))


if __name__ == "__main__":
    main()
`;
}

module.exports = { buildTrainingScript };
