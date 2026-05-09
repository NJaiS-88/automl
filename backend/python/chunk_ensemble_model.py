from collections import Counter

import numpy as np


class ChunkEnsembleModel:
    def __init__(self, models, problem_type="classification"):
        self.models = list(models or [])
        self.problem_type = problem_type
        self.classes_ = self._collect_classes()

    def _collect_classes(self):
        classes = []
        for model in self.models:
            for cls in getattr(model, "classes_", []):
                if cls not in classes:
                    classes.append(cls)
        return np.array(classes) if classes else np.array([])

    def predict(self, X):
        if not self.models:
            raise RuntimeError("ChunkEnsembleModel has no fitted models.")
        preds = [model.predict(X) for model in self.models]
        if self.problem_type == "regression":
            stacked = np.vstack(preds)
            return np.mean(stacked, axis=0)

        merged = []
        for row_values in zip(*preds):
            voted = Counter(row_values).most_common(1)[0][0]
            merged.append(voted)
        return np.array(merged)

    def predict_proba(self, X):
        if self.problem_type != "classification" or not self.models:
            raise AttributeError("predict_proba is only available for classification ensembles.")
        if self.classes_.size == 0:
            raise AttributeError("No class labels found for probability prediction.")

        model_probas = []
        for model in self.models:
            if not hasattr(model, "predict_proba"):
                continue
            raw = model.predict_proba(X)
            model_classes = list(getattr(model, "classes_", []))
            aligned = np.zeros((raw.shape[0], len(self.classes_)))
            for idx, cls in enumerate(self.classes_):
                if cls in model_classes:
                    aligned[:, idx] = raw[:, model_classes.index(cls)]
            model_probas.append(aligned)

        if not model_probas:
            raise AttributeError("None of the chunk models support predict_proba.")
        return np.mean(np.stack(model_probas, axis=0), axis=0)
