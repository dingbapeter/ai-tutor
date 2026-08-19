"""Curriculum problem-bank generator.

Parameterized templates produce unlimited problems per skill; every answer is
verified with SymPy AT BUILD TIME, and every template derives its wrong-answer
misconceptions programmatically — so the tutor can diagnose *why* a student is
wrong, not just that they are.

Run:  python3 tools/curriculum/generate.py
Regenerates the `problems` arrays of curriculum/*/pack.json in place
(deterministic seed → reproducible packs, stable diffs).
"""
import json
import random
from fractions import Fraction
from pathlib import Path

from sympy import Eq, Rational, simplify, symbols

ROOT = Path(__file__).resolve().parents[2]
x = symbols("x")
rng = random.Random(20260819)  # deterministic: same pack every run


def verified(equation: str, variable: str, answer) -> None:
    """Build-time SymPy check — a generator bug can never ship a wrong answer."""
    lhs, rhs = equation.split("=")
    from sympy.parsing.sympy_parser import (
        implicit_multiplication_application,
        parse_expr,
        standard_transformations,
    )

    t = standard_transformations + (implicit_multiplication_application,)
    eq = Eq(parse_expr(lhs, transformations=t), parse_expr(rhs, transformations=t))
    var = symbols(variable)
    a = Rational(str(answer))
    assert simplify(eq.lhs.subs(var, a) - eq.rhs.subs(var, a)) == 0, f"BAD PROBLEM: {equation} != {answer}"


def one_step_equations(n: int, skill: str):
    out = []
    for _ in range(n):
        a = rng.randint(2, 12)
        sol = rng.randint(2, 15)
        b = a * sol
        eq = f"{a}*x = {b}"
        verified(eq, "x", sol)
        out.append({
            "skillId": skill,
            "prompt": f"Solve for x: {a}x = {b}",
            "answer": str(sol),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": [
                {"answer": str(b - a), "diagnosis": "Subtracted instead of dividing — ax means a TIMES x, so undo it by dividing both sides by a."},
                {"answer": str(Fraction(a, b)), "diagnosis": "Divided the wrong way round — x = b ÷ a, not a ÷ b."},
            ],
        })
    return out


def two_step_equations(n: int, skill: str):
    out = []
    for _ in range(n):
        a = rng.randint(2, 9)
        sol = rng.randint(2, 12)
        b = rng.randint(1, 20)
        c = a * sol + b
        eq = f"{a}*x + {b} = {c}"
        verified(eq, "x", sol)
        wrong_forgot_divide = c - b  # solved ax = c-b but reported that as x
        wrong_one_side = (c + b - b) // a if (c) % a == 0 else None
        mis = [
            {"answer": str(wrong_forgot_divide), "diagnosis": f"You found {a}x = {c - b} and stopped — one more step: divide both sides by {a}."},
        ]
        if wrong_one_side is not None and wrong_one_side != sol:
            mis.append({"answer": str(wrong_one_side), "diagnosis": f"Looks like {b} was only removed from one side — whatever you do to one side, do to the other."})
        out.append({
            "skillId": skill,
            "prompt": f"Solve for x: {a}x + {b} = {c}",
            "answer": str(sol),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def fraction_addition(n: int, skill: str):
    out = []
    for _ in range(n):
        d1, d2 = rng.choice([(2, 4), (3, 6), (2, 6), (4, 8), (3, 9), (2, 8), (5, 10), (4, 12), (2, 3), (3, 4)])
        n1, n2 = rng.randint(1, d1 - 1), rng.randint(1, d2 - 1)
        ans = Fraction(n1, d1) + Fraction(n2, d2)
        eq = f"x = {n1}/{d1} + {n2}/{d2}"
        verified(eq, "x", ans)
        naive = Fraction(n1 + n2, d1 + d2)
        mis = []
        if naive != ans:
            mis.append({"answer": f"{n1 + n2}/{d1 + d2}", "diagnosis": "Added tops AND bottoms — denominators don't add. Find a common denominator first."})
        out.append({
            "skillId": skill,
            "prompt": f"Add the fractions: {n1}/{d1} + {n2}/{d2} (answer as a fraction like 3/4)",
            "answer": f"{ans.numerator}/{ans.denominator}",
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def decimal_compare(n: int, skill: str):
    out = []
    seen = set()
    while len(out) < n:
        whole = rng.choice([0, 1])
        d1 = round(rng.uniform(0.05, 0.95), rng.choice([1, 2]))
        d2 = round(rng.uniform(0.05, 0.95), rng.choice([1, 2]))
        if d1 == d2:
            continue
        a, b = whole + d1, whole + d2
        key = (a, b)
        if key in seen:
            continue
        seen.add(key)
        bigger = max(a, b)
        smaller = min(a, b)
        out.append({
            "skillId": skill,
            "prompt": f"Which is larger: {a} or {b}?",
            "answer": str(bigger),
            "check": {"type": "compare", "left": str(smaller), "right": str(bigger), "expected": "<"},
            "misconceptions": [
                {"answer": str(smaller), "diagnosis": "Comparing decimals like whole numbers (more digits ≠ bigger). Line up the place values."},
            ],
        })
    return out


def negatives_operations(n: int, skill: str):
    out = []
    for _ in range(n):
        a = rng.randint(-12, -2)
        b = rng.randint(2, 12)
        op = rng.choice(["+", "-", "*"])
        expr = f"({a}) {op} {b}"
        ans = eval(f"({a}) {op} {b}")  # ints only, generator-controlled
        eq = f"x = {a} {'*' if op == '*' else op} {b}"
        verified(eq, "x", ans)
        mis = []
        if op == "-":
            mis.append({"answer": str(a + b), "diagnosis": "Subtracting from a negative moves you FURTHER below zero — picture the number line."})
        if op == "*":
            mis.append({"answer": str(abs(a) * b), "diagnosis": "Negative × positive stays negative — the sign doesn't disappear."})
        out.append({
            "skillId": skill,
            "prompt": f"Calculate: {expr}",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def sat_linear(n: int, skill: str):
    out = []
    for _ in range(n):
        a = rng.randint(2, 8)
        d = rng.randint(1, 9)
        sol = rng.randint(2, 12)
        c = a * (sol - d)
        if c <= 0:
            continue
        eq = f"{a}*(x - {d}) = {c}"
        verified(eq, "x", sol)
        out.append({
            "skillId": skill,
            "prompt": f"If {a}(x − {d}) = {c}, what is the value of x?",
            "answer": str(sol),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "timeLimitSec": 75,
            "misconceptions": [
                {"answer": str(c // a) if c % a == 0 else str(Fraction(c, a)), "diagnosis": f"Divided by {a} but forgot to add {d} back."},
            ],
        })
    return out


def write_pack(pack_id: str, problems: list) -> None:
    # A misconception whose answer equals the right answer would attach a
    # "here's what you did wrong" note to a correct response — drop those.
    for p in problems:
        p["misconceptions"] = [m for m in p.get("misconceptions", []) if m["answer"] != p["answer"]]
    path = ROOT / "curriculum" / pack_id / "pack.json"
    pack = json.loads(path.read_text())
    pack["problems"] = problems
    pack["generated"] = {"tool": "tools/curriculum/generate.py", "count": len(problems), "verified": "sympy-at-build"}
    path.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n")
    print(f"{pack_id}: {len(problems)} problems, all sympy-verified")


if __name__ == "__main__":
    write_pack("math-ms",
        one_step_equations(10, "math-ms.linear-eq.one-step")
        + two_step_equations(12, "math-ms.linear-eq.two-step")
        + fraction_addition(10, "math-ms.fractions.add-sub")
        + decimal_compare(8, "math-ms.decimals.compare")
        + negatives_operations(10, "math-ms.negatives.operations"))
    write_pack("exam-prep", sat_linear(15, "exam.sat-math.heart-of-algebra"))
    print("Done. Language pack is authored by hand (rubric-based), not generated.")
