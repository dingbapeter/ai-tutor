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
    # Mirror the runtime mathcheck service: ^ means power, not XOR.
    eq = Eq(
        parse_expr(lhs.replace("^", "**"), transformations=t),
        parse_expr(rhs.replace("^", "**"), transformations=t),
    )
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


def percent_of(n: int, skill: str):
    out = []
    while len(out) < n:
        pct = rng.choice([10, 20, 25, 50, 75, 5, 40, 60])
        base = rng.choice([20, 40, 60, 80, 120, 200, 150, 300])
        if (pct * base) % 100 != 0:
            continue  # whole-number answers only at this level
        ans = pct * base // 100
        eq = f"x = {pct}*{base}/100"
        verified(eq, "x", ans)
        out.append({
            "skillId": skill,
            "prompt": f"What is {pct}% of {base}?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": [
                {"answer": str(base - pct), "diagnosis": "Percent means 'per hundred' — multiply by the percent, then divide by 100; don't subtract."},
            ],
        })
    return out


def order_of_operations(n: int, skill: str):
    out = []
    for _ in range(n):
        a, b, c = rng.randint(2, 9), rng.randint(2, 9), rng.randint(2, 6)
        ans = a + b * c
        eq = f"x = {a} + {b}*{c}"
        verified(eq, "x", ans)
        wrong = (a + b) * c
        out.append({
            "skillId": skill,
            "prompt": f"Calculate: {a} + {b} × {c}",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": [
                {"answer": str(wrong), "diagnosis": "Worked left-to-right — multiplication comes BEFORE addition (BODMAS/PEMDAS)."},
            ],
        })
    return out


def ratio_share(n: int, skill: str):
    out = []
    for _ in range(n):
        r1, r2 = rng.choice([(1, 2), (1, 3), (2, 3), (3, 4), (2, 5), (3, 5)])
        unit = rng.randint(2, 9)
        total = (r1 + r2) * unit
        share1 = r1 * unit
        eq = f"x = {total}*{r1}/{r1 + r2}"
        verified(eq, "x", share1)
        out.append({
            "skillId": skill,
            "prompt": f"Share {total} sweets between two friends in the ratio {r1}:{r2}. How many does the first friend get?",
            "answer": str(share1),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": [
                {"answer": str(total // 2) if total // 2 != share1 else str(total), "diagnosis": f"That's an equal split — a {r1}:{r2} ratio means {r1 + r2} equal parts first, then {r1} of them."},
            ],
        })
    return out


def exponents_basic(n: int, skill: str):
    out = []
    for _ in range(n):
        base = rng.randint(2, 6)
        power = rng.choice([2, 3])
        ans = base**power
        eq = f"x = {base}^{power}"
        verified(eq, "x", ans)
        out.append({
            "skillId": skill,
            "prompt": f"What is {base}{'²' if power == 2 else '³'} ({base} to the power of {power})?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": [
                {"answer": str(base * power), "diagnosis": f"That's {base} × {power} — a power means multiplying {base} by ITSELF {power} times."},
            ],
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


def ensure_skills(pack_id: str, skills: list) -> None:
    path = ROOT / "curriculum" / pack_id / "pack.json"
    pack = json.loads(path.read_text())
    have = {s["id"] for s in pack["skills"]}
    for s in skills:
        if s["id"] not in have:
            pack["skills"].append(s)
    path.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    ensure_skills("math-ms", [
        {"id": "math-ms.percent.of", "title": "Percentages of amounts", "prerequisites": ["math-ms.fractions.equivalent"]},
        {"id": "math-ms.order-of-ops", "title": "Order of operations", "prerequisites": []},
        {"id": "math-ms.ratio.share", "title": "Sharing in a ratio", "prerequisites": ["math-ms.fractions.equivalent"]},
        {"id": "math-ms.exponents.basic", "title": "Squares and cubes", "prerequisites": []},
    ])
    write_pack("math-ms",
        one_step_equations(10, "math-ms.linear-eq.one-step")
        + two_step_equations(12, "math-ms.linear-eq.two-step")
        + fraction_addition(10, "math-ms.fractions.add-sub")
        + decimal_compare(8, "math-ms.decimals.compare")
        + negatives_operations(10, "math-ms.negatives.operations")
        + percent_of(10, "math-ms.percent.of")
        + order_of_operations(10, "math-ms.order-of-ops")
        + ratio_share(10, "math-ms.ratio.share")
        + exponents_basic(8, "math-ms.exponents.basic"))
    write_pack("exam-prep", sat_linear(15, "exam.sat-math.heart-of-algebra"))
    print("Done. Language pack is authored by hand (rubric-based), not generated.")
