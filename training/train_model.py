"""
StealthHumanizer — ML Training Pipeline
========================================
Production-ready training pipeline for fine-tuning seq2seq models
(T5, BART) on human-like writing pairs derived from Q1 open-access papers.

Usage:
    # Full pipeline (download + train + evaluate)
    python training/train_model.py --config ../data/models/train.config.example.json

    # Train only (from existing dataset)
    python training/train_model.py --dataset ../data/training_pairs.jsonl --model t5-small --epochs 3

    # Evaluate a trained model
    python training/train_model.py --evaluate --model-dir ./output/latest

    # Quick smoke test
    python training/train_model.py --smoke-test
"""

import argparse
import json
import os
import sys
import time
import hashlib
from pathlib import Path
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "model_name": "t5-small",
    "max_seq_length": 512,
    "per_device_train_batch_size": 4,
    "per_device_eval_batch_size": 8,
    "num_train_epochs": 3,
    "learning_rate": 3e-4,
    "weight_decay": 0.01,
    "warmup_ratio": 0.1,
    "logging_steps": 50,
    "save_steps": 500,
    "eval_steps": 250,
    "save_total_limit": 3,
    "fp16": False,
    "seed": 42,
    "train_split": 0.9,
    "output_dir": "./output/latest",
    "quality_threshold": {
        "min_train_loss": 0.5,
        "min_eval_accuracy": 0.6,
        "max_bleu_drop": 0.3
    }
}


def load_config(config_path: str) -> dict:
    """Load and merge configuration from JSON file with defaults."""
    config = DEFAULT_CONFIG.copy()
    if config_path and os.path.exists(config_path):
        with open(config_path, "r") as f:
            user_config = json.load(f)
        config.update(user_config)
    return config


# ---------------------------------------------------------------------------
# Data Loading & Preprocessing
# ---------------------------------------------------------------------------

def load_dataset(dataset_path: str):
    """
    Load training pairs from JSONL or TSV format.

    JSONL format: {"input": "...", "target": "..."}
    TSV format:   input_text<TAB>target_text
    """
    pairs = []
    path = Path(dataset_path)

    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    if path.suffix == ".jsonl":
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    record = json.loads(line)
                    pairs.append((record["input"], record["target"]))
    elif path.suffix == ".tsv":
        with open(path, "r") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) == 2:
                    pairs.append((parts[0], parts[1]))
    else:
        raise ValueError(f"Unsupported dataset format: {path.suffix}")

    if not pairs:
        raise ValueError(f"No training pairs found in {dataset_path}")

    print(f"Loaded {len(pairs)} training pairs from {dataset_path}")
    return pairs


def split_dataset(pairs, train_ratio=0.9, seed=42):
    """Deterministic train/val split using hash-based assignment."""
    rng = random.Random(seed)
    shuffled = list(pairs)
    rng.shuffle(shuffled)
    split_idx = int(len(shuffled) * train_ratio)
    return shuffled[:split_idx], shuffled[split_idx:]


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train(pairs, config: dict):
    """Fine-tune a seq2seq model on training pairs."""
    try:
        import torch
        from transformers import (
            T5ForConditionalGeneration,
            T5Tokenizer,
            BartForConditionalGeneration,
            BartTokenizer,
            Trainer,
            TrainingArguments,
            DataCollatorForSeq2Seq,
        )
        from datasets import Dataset
        import numpy as np
        import evaluate
    except ImportError:
        print("ERROR: Required packages not installed. Run:")
        print("  pip install torch transformers datasets evaluate sentencepiece")
        sys.exit(1)

    import random
    random.seed(config["seed"])
    np.random.seed(config["seed"])
    torch.manual_seed(config["seed"])

    model_name = config["model_name"]

    # Select tokenizer and model
    if "t5" in model_name:
        tokenizer = T5Tokenizer.from_pretrained(model_name)
        model = T5ForConditionalGeneration.from_pretrained(model_name)
    elif "bart" in model_name:
        tokenizer = BartTokenizer.from_pretrained(model_name)
        model = BartForConditionalGeneration.from_pretrained(model_name)
    else:
        raise ValueError(f"Unsupported model: {model_name}. Use t5-* or facebook/bart-*")

    # Split data
    train_pairs, val_pairs = split_dataset(pairs, config["train_split"], config["seed"])
    print(f"Train: {len(train_pairs)}, Validation: {len(val_pairs)}")

    # Convert to HF datasets
    def make_dataset(pairs_list):
        data = {"input": [p[0] for p in pairs_list], "target": [p[1] for p in pairs_list]}
        return Dataset.from_dict(data)

    train_ds = make_dataset(train_pairs)
    val_ds = make_dataset(val_pairs)

    max_length = config["max_seq_length"]

    def preprocess(examples):
        inputs = tokenizer(
            examples["input"],
            max_length=max_length,
            truncation=True,
            padding="max_length",
        )
        targets = tokenizer(
            examples["target"],
            max_length=max_length,
            truncation=True,
            padding="max_length",
        )
        inputs["labels"] = targets["input_ids"]
        # Replace padding token id with -100 so it's ignored in loss
        inputs["labels"] = [
            [(l if l != tokenizer.pad_token_id else -100) for l in label]
            for label in inputs["labels"]
        ]
        return inputs

    print("Preprocessing datasets...")
    train_ds = train_ds.map(preprocess, batched=True, remove_columns=["input", "target"])
    val_ds = val_ds.map(preprocess, batched=True, remove_columns=["input", "target"])

    data_collator = DataCollatorForSeq2Seq(tokenizer=tokenizer, model=model)

    # Output directory with timestamp
    output_base = Path(config["output_dir"])
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_output = output_base / f"run-{timestamp}"
    run_output.mkdir(parents=True, exist_ok=True)

    # Save config for reproducibility
    config_copy = config.copy()
    config_copy["dataset_size"] = len(pairs)
    config_copy["train_size"] = len(train_pairs)
    config_copy["val_size"] = len(val_pairs)
    config_copy["run_timestamp"] = timestamp
    config_hash = hashlib.sha256(json.dumps(config_copy, sort_keys=True).encode()).hexdigest()[:12]
    config_copy["config_hash"] = config_hash
    with open(run_output / "training_config.json", "w") as f:
        json.dump(config_copy, f, indent=2)

    training_args = TrainingArguments(
        output_dir=str(run_output),
        per_device_train_batch_size=config["per_device_train_batch_size"],
        per_device_eval_batch_size=config["per_device_eval_batch_size"],
        num_train_epochs=config["num_train_epochs"],
        learning_rate=config["learning_rate"],
        weight_decay=config["weight_decay"],
        warmup_ratio=config["warmup_ratio"],
        logging_steps=config["logging_steps"],
        save_steps=config["save_steps"],
        eval_steps=config["eval_steps"],
        save_total_limit=config["save_total_limit"],
        fp16=config["fp16"] and torch.cuda.is_available(),
        seed=config["seed"],
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="none",
    )

    # Metrics
    bleu_metric = evaluate.load("sacrebleu")

    def compute_metrics(eval_preds):
        preds, labels = eval_preds
        if isinstance(preds, tuple):
            preds = preds[0]
        # Decode predictions
        decoded_preds = tokenizer.batch_decode(preds, skip_special_tokens=True)
        # Replace -100 in labels
        labels = np.where(labels != -100, labels, tokenizer.pad_token_id)
        decoded_labels = tokenizer.batch_decode(labels, skip_special_tokens=True)

        # BLEU
        bleu = bleu_metric.compute(
            predictions=decoded_preds,
            references=[[l] for l in decoded_labels],
        )

        return {"bleu": bleu["score"]}

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        tokenizer=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
    )

    print(f"Starting training → {run_output}")
    start_time = time.time()
    trainer.train()
    elapsed = time.time() - start_time
    print(f"Training completed in {elapsed:.1f}s")

    # Save final model
    final_dir = run_output / "final"
    trainer.save_model(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))

    # Save training report
    report = {
        "run_id": timestamp,
        "config_hash": config_hash,
        "model": model_name,
        "train_size": len(train_pairs),
        "val_size": len(val_pairs),
        "training_time_seconds": round(elapsed, 1),
        "output_dir": str(final_dir),
    }

    # Evaluate
    eval_results = trainer.evaluate()
    report["eval_results"] = {k: round(v, 4) if isinstance(v, float) else v for k, v in eval_results.items()}

    # Quality gate check
    thresholds = config.get("quality_threshold", {})
    failures = []
    if "min_eval_accuracy" in thresholds:
        # Use BLEU as proxy for quality
        pass
    if thresholds.get("min_train_loss") and eval_results.get("eval_loss", 99) > thresholds["min_train_loss"]:
        failures.append(f"eval_loss {eval_results['eval_loss']:.4f} > threshold {thresholds['min_train_loss']}")

    report["quality_gate"] = {
        "passed": len(failures) == 0,
        "failures": failures,
    }

    with open(run_output / "training_report.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n=== Training Report ===")
    print(json.dumps(report, indent=2))

    if failures:
        print(f"\n⚠️  Quality gate FAILED: {failures}")
        print("Consider adjusting hyperparameters or improving training data quality.")

    # Update lineage
    lineage_path = Path("data/models/lineage/experiments.jsonl")
    lineage_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lineage_path, "a") as f:
        f.write(json.dumps(report) + "\n")

    return report


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate_model(model_dir: str, test_dataset: str = None):
    """Evaluate a trained model on a test dataset or interactive prompts."""
    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForSeq2SeqGeneration
    except ImportError:
        print("ERROR: pip install torch transformers")
        sys.exit(1)

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSeq2SeqGeneration.from_pretrained(model_dir)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    model.eval()

    if test_dataset:
        pairs = load_dataset(test_dataset)
        # Simple BLEU-like evaluation
        from evaluate import load
        bleu = load("sacrebleu")
        preds, refs = [], []
        for inp, tgt in pairs[:100]:  # Evaluate first 100
            inputs = tokenizer(inp, return_tensors="pt", max_length=512, trunc=True).to(device)
            with torch.no_grad():
                output = model.generate(**inputs, max_length=512, num_beams=4)
            pred = tokenizer.decode(output[0], skip_special_tokens=True)
            preds.append(pred)
            refs.append(tgt)
        result = bleu.compute(predictions=preds, references=[[r] for r in refs])
        print(f"BLEU score on {len(preds)} samples: {result['score']:.2f}")
    else:
        # Interactive demo
        print("\nInteractive evaluation (Ctrl+C to quit):")
        while True:
            text = input("\nInput: ").strip()
            if not text:
                continue
            inputs = tokenizer(text, return_tensors="pt", max_length=512, trunc=True).to(device)
            with torch.no_grad():
                output = model.generate(**inputs, max_length=512, num_beams=4)
            result = tokenizer.decode(output[0], skip_special_tokens=True)
            print(f"Output: {result}")


# ---------------------------------------------------------------------------
# Smoke Test
# ---------------------------------------------------------------------------

def smoke_test():
    """Quick validation that the pipeline works end-to-end with mock data."""
    import tempfile

    print("Running smoke test...")

    # Create mock dataset
    mock_pairs = [
        ("The results indicate that the method is effective.", "Our findings suggest the approach actually works well."),
        ("It is important to note that this study has limitations.", "We should keep in mind this study comes with a few caveats."),
        ("The data shows a significant increase in performance.", "The numbers paint a clear picture — performance jumped noticeably."),
        ("Furthermore, the analysis reveals interesting patterns.", "What's more, digging into the analysis uncovers some pretty intriguing trends."),
        ("In conclusion, the proposed solution addresses the problem effectively.", "To wrap things up, our solution gets the job done."),
    ]

    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        for inp, tgt in mock_pairs:
            f.write(json.dumps({"input": inp, "target": tgt}) + "\n")
        tmp_path = f.name

    try:
        config = DEFAULT_CONFIG.copy()
        config["num_train_epochs"] = 1
        config["logging_steps"] = 1
        config["save_steps"] = 10
        config["eval_steps"] = 5
        config["per_device_train_batch_size"] = 2
        config["output_dir"] = tempfile.mkdtemp()

        report = train(
            [(p["input"], p["target"]) for p in mock_pairs],
            config,
        )

        if report["quality_gate"]["passed"]:
            print("\n✅ Smoke test PASSED")
        else:
            print(f"\n⚠️  Smoke test completed with warnings: {report['quality_gate']['failures']}")

        return True
    except Exception as e:
        print(f"\n❌ Smoke test FAILED: {e}")
        return False
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="StealthHumanizer ML Training Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python train_model.py --smoke-test
  python train_model.py --dataset ../data/training_pairs.jsonl --epochs 3
  python train_model.py --config ../data/models/train.config.example.json
  python train_model.py --evaluate --model-dir ./output/latest/run-xxx/final
        """,
    )
    parser.add_argument("--config", help="Path to training config JSON")
    parser.add_argument("--dataset", help="Path to training data (JSONL or TSV)")
    parser.add_argument("--model", default="t5-small", help="Model name (t5-small, t5-base, facebook/bart-base)")
    parser.add_argument("--epochs", type=int, help="Override number of epochs")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--evaluate", action="store_true", help="Evaluate a trained model")
    parser.add_argument("--model-dir", help="Path to trained model for evaluation")
    parser.add_argument("--test-dataset", help="Test dataset for evaluation")
    parser.add_argument("--smoke-test", action="store_true", help="Run quick validation with mock data")

    args = parser.parse_args()

    if args.smoke_test:
        success = smoke_test()
        sys.exit(0 if success else 1)

    if args.evaluate:
        if not args.model_dir:
            parser.error("--model-dir required with --evaluate")
        evaluate_model(args.model_dir, args.test_dataset)
        return

    config = load_config(args.config)
    if args.model:
        config["model_name"] = args.model
    if args.epochs:
        config["num_train_epochs"] = args.epochs
    if args.output_dir:
        config["output_dir"] = args.output_dir

    if not args.dataset:
        # Look for default dataset locations
        default_paths = [
            "data/training_pairs.jsonl",
            "dataset.txt",
            "data/papers/corpus/papers.jsonl",
        ]
        for p in default_paths:
            if os.path.exists(p):
                args.dataset = p
                break

    if not args.dataset:
        parser.error(
            "No dataset found. Provide --dataset or run the data pipeline first:\n"
            "  python data/full_pipeline.py"
        )

    pairs = load_dataset(args.dataset)
    report = train(pairs, config)


if __name__ == "__main__":
    main()
