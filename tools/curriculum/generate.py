"""Curriculum problem-bank generator.

Parameterized templates produce unlimited problems per skill; every answer is
verified with SymPy AT BUILD TIME, and every template derives its wrong-answer
misconceptions programmatically — so the tutor can diagnose *why* a student is
wrong, not just that they are.

Run:  python3 tools/curriculum/generate.py
Regenerates the `problems` arrays of curriculum/*/pack.json in place
(deterministic seed → reproducible packs, stable diffs). Hand-authored rubric
problems are preserved; only machine-verifiable problems are regenerated.
"""
import json
import random
from fractions import Fraction
from pathlib import Path

from sympy import Eq, Rational, simplify, symbols
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

ROOT = Path(__file__).resolve().parents[2]
x = symbols("x")
rng = random.Random(20260819)  # deterministic: same pack every run

TRANSFORMS = standard_transformations + (implicit_multiplication_application,)


def verified(equation: str, variable: str, answer) -> None:
    """Build-time SymPy check — a generator bug can never ship a wrong answer."""
    lhs, rhs = equation.split("=")
    # Mirror the runtime mathcheck service: ^ means power, not XOR.
    eq = Eq(
        parse_expr(lhs.replace("^", "**"), transformations=TRANSFORMS),
        parse_expr(rhs.replace("^", "**"), transformations=TRANSFORMS),
    )
    var = symbols(variable)
    a = Rational(str(answer))
    assert simplify(eq.lhs.subs(var, a) - eq.rhs.subs(var, a)) == 0, f"BAD PROBLEM: {equation} != {answer}"


def verified_equivalent(expression: str, answer: str) -> None:
    """Build-time check for equivalence problems: the canonical answer must be
    symbolically equal to the checked expression and contain no brackets (the
    runtime rejects bracketed answers so the prompt can't be typed back)."""
    assert "(" not in answer, f"BAD PROBLEM: canonical answer {answer!r} contains brackets"
    diff = simplify(
        parse_expr(expression.replace("^", "**"), transformations=TRANSFORMS)
        - parse_expr(answer.replace("^", "**"), transformations=TRANSFORMS)
    )
    assert diff == 0, f"BAD PROBLEM: {expression} not equivalent to {answer}"


def frac_str(f: Fraction) -> str:
    return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"


# ---------------------------------------------------------------- existing skills

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
                {"answer": str(b - a), "diagnosis": "Subtracted instead of dividing. ax means a TIMES x, so undo it by dividing both sides by a."},
                {"answer": str(Fraction(a, b)), "diagnosis": "Divided the wrong way round: x = b ÷ a, not a ÷ b."},
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
            {"answer": str(wrong_forgot_divide), "diagnosis": f"You found {a}x = {c - b} and stopped. One more step: divide both sides by {a}."},
        ]
        if wrong_one_side is not None and wrong_one_side != sol:
            mis.append({"answer": str(wrong_one_side), "diagnosis": f"Looks like {b} was only removed from one side. Whatever you do to one side, do to the other."})
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
            mis.append({"answer": f"{n1 + n2}/{d1 + d2}", "diagnosis": "Added tops AND bottoms, but denominators don't add. Find a common denominator first."})
        out.append({
            "skillId": skill,
            "prompt": f"Add the fractions: {n1}/{d1} + {n2}/{d2} (answer as a fraction like 3/4)",
            "answer": frac_str(ans),
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
                {"answer": str(smaller), "diagnosis": "Comparing decimals like whole numbers (more digits does not mean bigger). Line up the place values."},
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
            mis.append({"answer": str(a + b), "diagnosis": "Subtracting from a negative moves you FURTHER below zero. Picture the number line."})
        if op == "*":
            mis.append({"answer": str(abs(a) * b), "diagnosis": "Negative times positive stays negative. The sign doesn't disappear."})
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
                {"answer": str(base - pct), "diagnosis": "Percent means 'per hundred': multiply by the percent, then divide by 100. Don't subtract."},
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
                {"answer": str(wrong), "diagnosis": "Worked left-to-right, but multiplication comes BEFORE addition (BODMAS/PEMDAS)."},
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
                {"answer": str(total // 2) if total // 2 != share1 else str(total), "diagnosis": f"That's an equal split. A {r1}:{r2} ratio means {r1 + r2} equal parts first, then {r1} of them."},
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
                {"answer": str(base * power), "diagnosis": f"That's {base} × {power}. A power means multiplying {base} by ITSELF {power} times."},
            ],
        })
    return out


# ---------------------------------------------------------------- new skills

def fraction_equivalent(n: int, skill: str):
    out = []
    seen = set()
    while len(out) < n:
        num = rng.randint(1, 5)
        den = rng.randint(num + 1, 8)
        scale = rng.randint(2, 6)
        key = (num, den, scale)
        if key in seen or Fraction(num, den).denominator != den:
            continue  # only fractions already in lowest terms read cleanly
        seen.add(key)
        big_den = den * scale
        ans = num * scale
        eq = f"x/{big_den} = {num}/{den}"
        verified(eq, "x", ans)
        wrong = num + (big_den - den)  # added the same AMOUNT to top and bottom
        mis = []
        if wrong != ans:
            mis.append({"answer": str(wrong), "diagnosis": f"Added {big_den - den} to the top because the bottom grew by {big_den - den}. Equivalent fractions MULTIPLY top and bottom by the same number: the bottom was multiplied by {scale}."})
        out.append({
            "skillId": skill,
            "prompt": f"Fill in the missing number: {num}/{den} = ?/{big_den}",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def fraction_mul_div(n: int, skill: str):
    out = []
    for i in range(n):
        a, b = rng.randint(1, 5), rng.randint(2, 6)
        c, d = rng.randint(1, 5), rng.randint(2, 6)
        if i % 2 == 0:
            ans = Fraction(a, b) * Fraction(c, d)
            eq = f"x = ({a}/{b}) * ({c}/{d})"
            verified(eq, "x", ans)
            mis = []
            naive = Fraction(a + c, b + d)
            if naive != ans:
                mis.append({"answer": frac_str(naive), "diagnosis": "Added instead of multiplying. Multiply the tops together and the bottoms together."})
            out.append({
                "skillId": skill,
                "prompt": f"Multiply the fractions: {a}/{b} × {c}/{d} (answer as a fraction in simplest form)",
                "answer": frac_str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
        else:
            ans = Fraction(a, b) / Fraction(c, d)
            eq = f"x = ({a}/{b}) / ({c}/{d})"
            verified(eq, "x", ans)
            forgot_flip = Fraction(a, b) * Fraction(c, d)
            mis = []
            if forgot_flip != ans:
                mis.append({"answer": frac_str(forgot_flip), "diagnosis": "Multiplied without flipping. Dividing by a fraction means multiplying by its reciprocal (turn it upside down first)."})
            out.append({
                "skillId": skill,
                "prompt": f"Divide the fractions: {a}/{b} ÷ {c}/{d} (answer as a fraction in simplest form)",
                "answer": frac_str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
    return out


def fraction_of_amount(n: int, skill: str):
    out = []
    contexts = ["students in a class", "pages of a book", "marbles in a bag", "minutes of a lesson", "apples in a crate"]
    while len(out) < n:
        num = rng.randint(1, 4)
        den = rng.randint(2, 6)
        if num >= den:
            continue
        unit = rng.randint(3, 12)
        total = den * unit
        ans = num * unit
        eq = f"x = {total}*{num}/{den}"
        verified(eq, "x", ans)
        ctx = rng.choice(contexts)
        mis = []
        if num > 1 and total % num == 0 and total // num != ans:
            mis.append({"answer": str(total // num), "diagnosis": f"Divided by the top number. To find {num}/{den} of something: divide by {den} (the parts), then multiply by {num}."})
        out.append({
            "skillId": skill,
            "prompt": f"There are {total} {ctx}. How many is {num}/{den} of them?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def fmt_dec(cents: int) -> str:
    """An integer count of hundredths, printed as a clean decimal string."""
    s = f"{cents // 100}.{cents % 100:02d}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def decimal_operations(n: int, skill: str):
    out = []
    for i in range(n):
        if i % 2 == 0:
            # Add two decimals with different decimal places: the classic
            # place-value trap. Work in hundredths so floats never drift.
            a = rng.randint(11, 89) * 10  # one decimal place, e.g. 3.70 stored as 370
            b = rng.randint(101, 899)     # two decimal places, e.g. 1.25 stored as 125
            if a % 100 == 0 or b % 10 == 0:
                continue
            ans = a + b
            a_str, b_str = f"{a // 100}.{(a % 100) // 10}", f"{b // 100}.{b % 100:02d}"
            # The check equation stays in exact fractions: a decimal literal
            # parses as a float and drifts (4.36*100 != 436 in float land).
            eq = f"x = {a}/100 + {b}/100"
            verified(eq, "x", Fraction(ans, 100))
            # The classic mistake: right-align the digits, ignore the point
            # (3.7 + 1.25 becomes 4.32 because 7+25=32).
            wrong = (a // 100 + b // 100) * 100 + ((a % 100) // 10 + b % 100)
            mis = []
            if wrong != ans:
                mis.append({"answer": fmt_dec(wrong), "diagnosis": "The decimal points must line up before you add. Tenths add to tenths, hundredths to hundredths."})
            out.append({
                "skillId": skill,
                "prompt": f"Calculate: {a_str} + {b_str}",
                "answer": fmt_dec(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
        else:
            cents = rng.randint(101, 989)
            if cents % 10 == 0:
                continue
            mult = rng.choice([10, 100])
            val = f"{cents // 100}.{cents % 100:02d}"
            ans = Fraction(cents * mult, 100)
            eq = f"x = ({cents}/100)*{mult}"  # exact fractions, never float literals
            verified(eq, "x", ans)
            wrong = format(cents / (100 * mult), "g")  # the ÷ mistake, as a learner would type it
            out.append({
                "skillId": skill,
                "prompt": f"Calculate: {val} × {mult}",
                "answer": frac_str(ans) if ans.denominator == 1 else fmt_dec(cents * mult),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": [
                    {"answer": wrong, "diagnosis": f"That's dividing by {mult}. Multiplying by {mult} moves the decimal point {'one place' if mult == 10 else 'two places'} to the RIGHT."},
                ],
            })
    return [p for p in out]


def percent_change(n: int, skill: str):
    out = []
    things = ["A jacket", "A phone", "A bus ticket", "A concert ticket", "A school bag"]
    while len(out) < n:
        base = rng.choice([40, 50, 60, 80, 120, 150, 200, 240, 300])
        pct = rng.choice([10, 20, 25, 50, 5, 15])
        if (base * pct) % 100 != 0:
            continue
        change = base * pct // 100
        up = rng.random() < 0.5
        ans = base + change if up else base - change
        eq = f"x = {base} {'+' if up else '-'} {base}*{pct}/100"
        verified(eq, "x", ans)
        verb = "goes up" if up else "is reduced"
        mis = [
            {"answer": str(base + pct if up else base - pct), "diagnosis": f"Treated {pct}% as {pct} units. Find {pct}% of {base} first, then {'add it on' if up else 'take it off'}."},
        ]
        if change != ans:
            mis.append({"answer": str(change), "diagnosis": f"That's the size of the change. The question asks for the new price, so {'add it to' if up else 'subtract it from'} {base}."})
        out.append({
            "skillId": skill,
            "prompt": f"{rng.choice(things)} costs {base}. The price {verb} by {pct}%. What is the new price?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def brackets_equations(n: int, skill: str):
    out = []
    for _ in range(n):
        a = rng.randint(2, 8)
        b = rng.randint(1, 9)
        sol = rng.randint(2, 12)
        c = a * (sol + b)
        eq = f"{a}*(x + {b}) = {c}"
        verified(eq, "x", sol)
        mis = []
        if (c - b) % a == 0 and (c - b) // a != sol:
            mis.append({"answer": str((c - b) // a), "diagnosis": f"The bracket means {a} multiplies EVERYTHING inside, the {b} too. Either expand first or divide both sides by {a} first."})
        out.append({
            "skillId": skill,
            "prompt": f"Solve for x: {a}(x + {b}) = {c}",
            "answer": str(sol),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def both_sides_equations(n: int, skill: str, time_limit=None):
    out = []
    while len(out) < n:
        a = rng.randint(4, 10)
        c = rng.randint(1, a - 2)
        sol = rng.randint(2, 10)
        b = rng.randint(1, 12)
        d = (a - c) * sol + b
        eq = f"{a}*x + {b} = {c}*x + {d}"
        verified(eq, "x", sol)
        mis = []
        if (d - b) % (a + c) == 0 and (d - b) // (a + c) != sol:
            mis.append({"answer": str((d - b) // (a + c)), "diagnosis": f"When {c}x crosses to the other side its sign flips: {a}x MINUS {c}x on the left, giving {a - c}x."})
        p = {
            "skillId": skill,
            "prompt": f"Solve for x: {a}x + {b} = {c}x + {d}",
            "answer": str(sol),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        }
        if time_limit:
            p["timeLimitSec"] = time_limit
        out.append(p)
    return out


def algebra_simplify(n: int, skill: str, time_limit=None):
    out = []
    for i in range(n):
        if i % 2 == 0:
            a, b = rng.randint(2, 9), rng.randint(2, 9)
            c = rng.randint(1, 9)
            expr = f"{a}*x + {b}*x + {c}"
            answer = f"{a + b}x + {c}"
            verified_equivalent(expr, answer)
            p = {
                "skillId": skill,
                "prompt": f"Simplify by collecting like terms: {a}x + {b}x + {c} (write the answer without brackets)",
                "answer": answer,
                "check": {"type": "equivalent", "expression": expr, "noParentheses": True},
            }
        else:
            a = rng.randint(2, 8)
            b = rng.randint(1, 9)
            expr = f"{a}*(x + {b})"
            answer = f"{a}x + {a * b}"
            verified_equivalent(expr, answer)
            p = {
                "skillId": skill,
                "prompt": f"Expand the bracket: {a}(x + {b}) (write the answer without brackets)",
                "answer": answer,
                "check": {"type": "equivalent", "expression": expr, "noParentheses": True},
            }
        if time_limit:
            p["timeLimitSec"] = time_limit
        out.append(p)
    return out


def geometry_rectangles(n: int, skill: str):
    out = []
    for i in range(n):
        w, h = rng.randint(3, 12), rng.randint(3, 12)
        if i % 2 == 0:
            ans = w * h
            eq = f"x = {w}*{h}"
            verified(eq, "x", ans)
            wrong = 2 * (w + h)
            mis = []
            if wrong != ans:
                mis.append({"answer": str(wrong), "diagnosis": "That's the perimeter (the distance around). Area is the space inside: length × width."})
            out.append({
                "skillId": skill,
                "prompt": f"A rectangle is {w} cm long and {h} cm wide. What is its area in cm²?",
                "answer": str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
        else:
            ans = 2 * (w + h)
            eq = f"x = 2*({w} + {h})"
            verified(eq, "x", ans)
            wrong = w * h
            mis = []
            if wrong != ans:
                mis.append({"answer": str(wrong), "diagnosis": "That's the area (the space inside). Perimeter is the distance AROUND: add up all four sides."})
            out.append({
                "skillId": skill,
                "prompt": f"A rectangle is {w} cm long and {h} cm wide. What is its perimeter in cm?",
                "answer": str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
    return out


def geometry_triangles(n: int, skill: str):
    out = []
    while len(out) < n:
        b = rng.randint(4, 14)
        h = rng.randint(3, 12)
        if (b * h) % 2 != 0:
            continue
        ans = b * h // 2
        eq = f"x = {b}*{h}/2"
        verified(eq, "x", ans)
        mis = []
        if b * h != ans:
            mis.append({"answer": str(b * h), "diagnosis": "That's base × height, which gives a rectangle. A triangle is HALF of that rectangle, so divide by 2."})
        out.append({
            "skillId": skill,
            "prompt": f"A triangle has a base of {b} cm and a height of {h} cm. What is its area in cm²?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def geometry_angles(n: int, skill: str):
    out = []
    for i in range(n):
        if i % 2 == 0:
            d = rng.randint(35, 145)
            ans = 180 - d
            eq = f"x = 180 - {d}"
            verified(eq, "x", ans)
            mis = []
            if 360 - d != ans:
                mis.append({"answer": str(360 - d), "diagnosis": "Angles on a straight LINE add to 180°. It's angles around a full point that add to 360°."})
            out.append({
                "skillId": skill,
                "prompt": f"Two angles sit together on a straight line. One is {d}°. What is the other?",
                "answer": str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
        else:
            a1 = rng.randint(30, 80)
            a2 = rng.randint(30, 80)
            ans = 180 - a1 - a2
            eq = f"x = 180 - {a1} - {a2}"
            verified(eq, "x", ans)
            mis = []
            if 360 - a1 - a2 != ans:
                mis.append({"answer": str(360 - a1 - a2), "diagnosis": "The three angles inside a triangle add to 180°, not 360°."})
            out.append({
                "skillId": skill,
                "prompt": f"A triangle has angles of {a1}° and {a2}°. What is the third angle?",
                "answer": str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
    return out


def stats_mean(n: int, skill: str):
    out = []
    while len(out) < n:
        count = rng.choice([4, 5])
        nums = [rng.randint(2, 20) for _ in range(count)]
        total = sum(nums)
        if total % count != 0:
            continue
        ans = total // count
        eq = f"x = ({' + '.join(map(str, nums))})/{count}"
        verified(eq, "x", ans)
        mis = []
        if total != ans:
            mis.append({"answer": str(total), "diagnosis": f"That's the total. The mean shares the total out equally: divide by how many numbers there are ({count})."})
        out.append({
            "skillId": skill,
            "prompt": f"Find the mean of these numbers: {', '.join(map(str, nums))}",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def sequences_arithmetic(n: int, skill: str):
    out = []
    for i in range(n):
        a = rng.randint(1, 12)
        d = rng.randint(2, 9)
        terms = [a + k * d for k in range(4)]
        if i % 2 == 0:
            ans = a + 4 * d
            eq = f"x = {a} + 4*{d}"
            verified(eq, "x", ans)
            out.append({
                "skillId": skill,
                "prompt": f"What is the next term in the sequence: {', '.join(map(str, terms))}, ...?",
                "answer": str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": [
                    {"answer": str(d), "diagnosis": f"That's the gap between terms. The next TERM is the last one plus the gap: {terms[-1]} + {d}."},
                ],
            })
        else:
            k = rng.choice([10, 20])
            ans = a + (k - 1) * d
            eq = f"x = {a} + ({k} - 1)*{d}"
            verified(eq, "x", ans)
            mis = []
            if a + k * d != ans:
                mis.append({"answer": str(a + k * d), "diagnosis": f"Off by one jump: term {k} is the FIRST term plus {k - 1} jumps of {d}, not {k} jumps."})
            out.append({
                "skillId": skill,
                "prompt": f"The sequence {', '.join(map(str, terms))}, ... continues with the same gap. What is the {k}th term?",
                "answer": str(ans),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": mis,
            })
    return out


def exponents_roots(n: int, skill: str):
    out = []
    seen = set()
    while len(out) < n:
        root = rng.randint(2, 15)
        if root in seen:
            continue
        seen.add(root)
        sq = root * root
        eq = f"x = {sq}^(1/2)"
        verified(eq, "x", root)
        mis = []
        if sq % 2 == 0 and sq // 2 != root:
            mis.append({"answer": str(sq // 2), "diagnosis": f"That's half of {sq}. A square root asks: which number times ITSELF makes {sq}?"})
        out.append({
            "skillId": skill,
            "prompt": f"What is the square root of {sq}?",
            "answer": str(root),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def rates_speed(n: int, skill: str):
    out = []
    while len(out) < n:
        t = rng.randint(2, 6)
        speed = rng.choice([40, 50, 60, 70, 80, 90, 15, 20, 25])
        dist = speed * t
        ans = speed
        eq = f"x = {dist}/{t}"
        verified(eq, "x", ans)
        mis = []
        if dist * t != ans:
            mis.append({"answer": str(dist * t), "diagnosis": "Multiplied distance by time. Speed is distance DIVIDED by time (km per hour means km ÷ hours)."})
        out.append({
            "skillId": skill,
            "prompt": f"A bus travels {dist} km in {t} hours at a steady speed. What is its speed in km/h?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def probability_simple(n: int, skill: str):
    out = []
    colors = [("red", "blue"), ("green", "yellow"), ("black", "white")]
    while len(out) < n:
        r = rng.randint(1, 6)
        g = rng.randint(1, 6)
        if r == g:
            continue
        c1, c2 = rng.choice(colors)
        ans = Fraction(r, r + g)
        eq = f"x = {r}/({r} + {g})"
        verified(eq, "x", ans)
        mis = []
        wrong = Fraction(r, g)
        if wrong != ans:
            mis.append({"answer": frac_str(wrong), "diagnosis": f"That compares {c1} to {c2} (a ratio). Probability compares {c1} to ALL the counters: {r} out of {r + g}."})
        out.append({
            "skillId": skill,
            "prompt": f"A bag holds {r} {c1} counters and {g} {c2} counters. You take one without looking. What is the probability it is {c1}? (answer as a fraction)",
            "answer": frac_str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


# ---------------------------------------------------------------- exam prep

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


def exam_percent_word(n: int, skill: str):
    out = []
    items = ["a laptop", "a bicycle", "a camera", "a pair of trainers", "a tablet"]
    while len(out) < n:
        price = rng.choice([120, 150, 200, 240, 300, 400, 480, 500])
        pct = rng.choice([10, 15, 20, 25, 30, 40])
        if (price * pct) % 100 != 0:
            continue
        ans = price - price * pct // 100
        eq = f"x = {price} - {price}*{pct}/100"
        verified(eq, "x", ans)
        mis = [
            {"answer": str(price - pct), "diagnosis": f"Took {pct} off instead of {pct}%. Work out {pct}% of {price} first, then subtract it."},
        ]
        if price * pct // 100 != ans:
            mis.append({"answer": str(price * pct // 100), "diagnosis": "That's the discount itself. The sale price is the original minus the discount."})
        out.append({
            "skillId": skill,
            "prompt": f"In a sale, {rng.choice(items)} priced at {price} is reduced by {pct}%. What is the sale price?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "timeLimitSec": 75,
            "misconceptions": mis,
        })
    return out


def exam_proportion(n: int, skill: str):
    out = []
    while len(out) < n:
        per = rng.randint(3, 9)          # items per unit
        units = rng.randint(3, 8)
        units2 = rng.randint(units + 1, 15)
        base_total = per * units
        ans = per * units2
        eq = f"x = ({base_total}/{units})*{units2}"
        verified(eq, "x", ans)
        mis = []
        if base_total + units2 != ans:
            mis.append({"answer": str(base_total + units2), "diagnosis": f"Added instead of scaling. Find how many per unit first ({base_total} ÷ {units} = {per}), then multiply by {units2}."})
        out.append({
            "skillId": skill,
            "prompt": f"A machine fills {base_total} bottles in {units} minutes at a steady rate. How many bottles does it fill in {units2} minutes?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "timeLimitSec": 75,
            "misconceptions": mis,
        })
    return out


# ---------------------------------------------------------------- professional finance

def fin_simple_interest(n: int, skill: str):
    out = []
    while len(out) < n:
        p = rng.choice([500, 1000, 2000, 2500, 4000, 5000])
        r = rng.choice([4, 5, 6, 8, 10])
        t = rng.randint(2, 5)
        if (p * r * t) % 100 != 0:
            continue
        ans = p * r * t // 100
        eq = f"x = {p}*{r}*{t}/100"
        verified(eq, "x", ans)
        out.append({
            "skillId": skill,
            "prompt": f"You invest {p:,} at {r}% simple interest per year. How much interest have you earned after {t} years?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": [
                {"answer": str(p * r // 100), "diagnosis": f"That's one year's interest. Simple interest repeats every year, so multiply by the {t} years."},
            ],
        })
    return out


def fin_compound_interest(n: int, skill: str):
    out = []
    while len(out) < n:
        p = rng.choice([1000, 2000, 5000, 10000])
        r = 10
        t = rng.randint(2, 3)
        amount = Fraction(p) * Fraction(100 + r, 100) ** t
        if amount.denominator != 1:
            continue
        ans = int(amount)
        eq = f"x = {p}*(1 + {r}/100)^{t}"
        verified(eq, "x", ans)
        simple = p + p * r * t // 100
        mis = []
        if simple != ans:
            mis.append({"answer": str(simple), "diagnosis": "That's simple interest. Compound interest earns interest ON the interest: multiply by 1.1 once per year, not add the same amount each year."})
        out.append({
            "skillId": skill,
            "prompt": f"You invest {p:,} at {r}% compound interest per year. What is the investment worth after {t} years?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


def fin_ratios(n: int, skill: str):
    out = []
    for i in range(n):
        if i % 2 == 0:
            liab = rng.choice([10000, 20000, 40000, 50000])
            mult = rng.choice([Fraction(3, 2), Fraction(2), Fraction(5, 2), Fraction(3)])
            assets = int(liab * mult)
            ans = mult
            eq = f"x = {assets}/{liab}"
            verified(eq, "x", ans)
            out.append({
                "skillId": skill,
                "prompt": f"A company has current assets of {assets:,} and current liabilities of {liab:,}. What is its current ratio?",
                "answer": frac_str(ans) if ans.denominator == 1 else str(float(ans)),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": [],
            })
        else:
            rev = rng.choice([200000, 400000, 500000, 800000])
            margin = rng.choice([10, 15, 20, 25, 30])
            profit = rev * margin // 100
            eq = f"x = 100*{profit}/{rev}"
            verified(eq, "x", margin)
            out.append({
                "skillId": skill,
                "prompt": f"A business earns a net profit of {profit:,} on revenue of {rev:,}. What is its net profit margin, as a percentage?",
                "answer": str(margin),
                "check": {"type": "solve", "equation": eq, "variable": "x"},
                "misconceptions": [],
            })
    return out


def fin_breakeven(n: int, skill: str):
    out = []
    while len(out) < n:
        fixed = rng.choice([12000, 18000, 24000, 30000, 36000])
        price = rng.randint(20, 60)
        var = rng.randint(5, price - 5)
        contrib = price - var
        if fixed % contrib != 0:
            continue
        ans = fixed // contrib
        eq = f"x = {fixed}/({price} - {var})"
        verified(eq, "x", ans)
        mis = []
        if fixed % price == 0 and fixed // price != ans:
            mis.append({"answer": str(fixed // price), "diagnosis": f"Divided by the selling price. Each unit only CONTRIBUTES {price} - {var} = {contrib} after its own variable cost, so divide fixed costs by {contrib}."})
        out.append({
            "skillId": skill,
            "prompt": f"A product sells for {price} with a variable cost of {var} per unit. Fixed costs are {fixed:,}. How many units must be sold to break even?",
            "answer": str(ans),
            "check": {"type": "solve", "equation": eq, "variable": "x"},
            "misconceptions": mis,
        })
    return out


# ---------------------------------------------------------------- writing

def write_pack(pack_id: str, problems: list) -> None:
    # A misconception whose answer equals the right answer would attach a
    # "here's what you did wrong" note to a correct response — drop those.
    for p in problems:
        p["misconceptions"] = [m for m in p.get("misconceptions", []) if m["answer"] != p["answer"]]
    path = ROOT / "curriculum" / pack_id / "pack.json"
    pack = json.loads(path.read_text())
    # Hand-authored rubric problems (visa answers, coaching reflections,
    # statement readings) are curriculum, not generator output: keep them.
    kept = [p for p in pack["problems"] if p.get("check", {}).get("type") == "rubric"]
    pack["problems"] = problems + kept
    pack["generated"] = {"tool": "tools/curriculum/generate.py", "count": len(problems), "verified": "sympy-at-build", "handAuthoredRubric": len(kept)}
    path.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n")
    print(f"{pack_id}: {len(problems)} generated (sympy-verified) + {len(kept)} hand-authored rubric problems")


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
        {"id": "math-ms.fractions.mul-div", "title": "Multiplying & dividing fractions", "prerequisites": ["math-ms.fractions.equivalent"]},
        {"id": "math-ms.fractions.of-amount", "title": "Fractions of amounts", "prerequisites": ["math-ms.fractions.equivalent"]},
        {"id": "math-ms.decimals.operations", "title": "Calculating with decimals", "prerequisites": ["math-ms.decimals.compare"]},
        {"id": "math-ms.percent.change", "title": "Percentage increase & decrease", "prerequisites": ["math-ms.percent.of"]},
        {"id": "math-ms.linear-eq.brackets", "title": "Equations with brackets", "prerequisites": ["math-ms.linear-eq.two-step"]},
        {"id": "math-ms.linear-eq.both-sides", "title": "Unknowns on both sides", "prerequisites": ["math-ms.linear-eq.two-step"]},
        {"id": "math-ms.algebra.simplify", "title": "Simplifying & expanding", "prerequisites": ["math-ms.linear-eq.one-step"]},
        {"id": "math-ms.geometry.rectangles", "title": "Area & perimeter of rectangles", "prerequisites": []},
        {"id": "math-ms.geometry.triangles", "title": "Area of triangles", "prerequisites": ["math-ms.geometry.rectangles"]},
        {"id": "math-ms.geometry.angles", "title": "Angle facts", "prerequisites": []},
        {"id": "math-ms.stats.mean", "title": "The mean average", "prerequisites": []},
        {"id": "math-ms.sequences.arithmetic", "title": "Number sequences", "prerequisites": []},
        {"id": "math-ms.exponents.roots", "title": "Square roots", "prerequisites": ["math-ms.exponents.basic"]},
        {"id": "math-ms.rates.speed", "title": "Speed, distance & time", "prerequisites": []},
        {"id": "math-ms.probability.simple", "title": "Simple probability", "prerequisites": ["math-ms.fractions.equivalent"]},
    ])
    write_pack("math-ms",
        fraction_equivalent(8, "math-ms.fractions.equivalent")
        + one_step_equations(10, "math-ms.linear-eq.one-step")
        + two_step_equations(12, "math-ms.linear-eq.two-step")
        + fraction_addition(10, "math-ms.fractions.add-sub")
        + decimal_compare(8, "math-ms.decimals.compare")
        + negatives_operations(10, "math-ms.negatives.operations")
        + percent_of(10, "math-ms.percent.of")
        + order_of_operations(10, "math-ms.order-of-ops")
        + ratio_share(10, "math-ms.ratio.share")
        + exponents_basic(8, "math-ms.exponents.basic")
        + fraction_mul_div(10, "math-ms.fractions.mul-div")
        + fraction_of_amount(8, "math-ms.fractions.of-amount")
        + decimal_operations(10, "math-ms.decimals.operations")
        + percent_change(8, "math-ms.percent.change")
        + brackets_equations(8, "math-ms.linear-eq.brackets")
        + both_sides_equations(8, "math-ms.linear-eq.both-sides")
        + algebra_simplify(10, "math-ms.algebra.simplify")
        + geometry_rectangles(8, "math-ms.geometry.rectangles")
        + geometry_triangles(6, "math-ms.geometry.triangles")
        + geometry_angles(8, "math-ms.geometry.angles")
        + stats_mean(6, "math-ms.stats.mean")
        + sequences_arithmetic(8, "math-ms.sequences.arithmetic")
        + exponents_roots(6, "math-ms.exponents.roots")
        + rates_speed(6, "math-ms.rates.speed")
        + probability_simple(6, "math-ms.probability.simple"))
    write_pack("exam-prep",
        sat_linear(15, "exam.sat-math.heart-of-algebra")
        + both_sides_equations(6, "exam.sat-math.heart-of-algebra", time_limit=75)
        + exam_percent_word(8, "exam.sat-math.problem-solving")
        + exam_proportion(6, "exam.sat-math.problem-solving")
        + algebra_simplify(8, "exam.waec-math.algebraic-processes", time_limit=90)
        + both_sides_equations(6, "exam.waec-math.algebraic-processes", time_limit=90))
    write_pack("pro-finance",
        fin_simple_interest(4, "fin.tvm.basics")
        + fin_compound_interest(4, "fin.tvm.basics")
        + fin_ratios(6, "fin.ratios.core")
        + fin_breakeven(4, "fin.exam.technique"))
    print("Done. Rubric problems (language, visa-prep, career-coach, and finance readings) are authored by hand, not generated.")
