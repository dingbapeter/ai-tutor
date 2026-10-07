"""Full-bank verification against the LIVE mathcheck service.

Every machine-verifiable problem in every pack is fired at the running
service exactly the way the API does at runtime:
  - the stored `answer` must come back CORRECT
  - every misconception's wrong answer must come back INCORRECT
  - compare-type problems are checked the way the API client checks them
    (the student names the larger side)

Run:  uvicorn main:app --port 8090   (in services/mathcheck)
      python3 tools/curriculum/verify_bank.py
Exits non-zero on any failure. This is the proof that the generator, the
packs on disk, and the runtime verifier agree with each other.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://localhost:8090"


def post(path: str, body: dict):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read()), res.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}"), e.code


def verify(check: dict, student_answer: str):
    """Mirror of apps/api/src/mathcheck.ts verifyAnswer."""
    if check["type"] == "solve":
        body, status = post("/check/solve", {
            "equation": check["equation"], "variable": check["variable"], "student_answer": student_answer,
        })
        return body.get("correct") if status == 200 else None
    if check["type"] == "compare":
        bigger = check["right"] if check["expected"] == "<" else check["left"]
        return student_answer.replace(" ", "") == bigger
    if check["type"] == "equivalent":
        body, status = post("/check/equivalent", {
            "expression": check["expression"], "student_expression": student_answer,
            "no_parentheses": check.get("noParentheses", False),
        })
        return body.get("correct") if status == 200 else None
    return None


def main() -> int:
    failures = []
    checked = mis_checked = 0
    for pack_path in sorted((ROOT / "curriculum").glob("*/pack.json")):
        pack = json.loads(pack_path.read_text())
        for i, p in enumerate(pack["problems"]):
            check = p.get("check") or {}
            if check.get("type") not in ("solve", "compare", "equivalent"):
                continue
            answer = p.get("answer")
            if answer is None:
                failures.append(f"{pack['id']}#{i}: verifiable problem with no stored answer")
                continue
            got = verify(check, str(answer))
            checked += 1
            if got is not True:
                failures.append(f"{pack['id']}#{i}: stored answer {answer!r} judged {got} for {p['prompt']!r}")
            for m in p.get("misconceptions", []):
                got = verify(check, str(m["answer"]))
                mis_checked += 1
                if got is not False:
                    failures.append(f"{pack['id']}#{i}: misconception answer {m['answer']!r} judged {got} (must be False) for {p['prompt']!r}")
    print(f"checked {checked} answers and {mis_checked} misconception answers against the live service")
    for f in failures:
        print("FAIL", f)
    print("RESULT:", "PASS" if not failures else f"{len(failures)} FAILURES")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
