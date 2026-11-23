"""Deterministic math verification behind the LLM.

The tutor model NEVER gets final say on numeric correctness — every checkable
answer runs through SymPy here. This is what lets a small self-hosted model
teach math reliably.

Input is untrusted (it includes student-typed answers), so expressions are
length-capped, charset-restricted, and complexity-limited before SymPy sees
them: a student typing 9**9**9**9 must get a 400, not take the service down.

Run: uvicorn main:app --port 8090
"""
import re

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sympy import Eq, Rational, simplify, symbols
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

app = FastAPI(title="mathcheck")

TRANSFORMS = standard_transformations + (implicit_multiplication_application,)

MAX_LEN = 200
ALLOWED = re.compile(r"^[0-9a-zA-Z+\-*/^=.,() _]*$")
MAX_EXPONENT_DIGITS = 4


def parse(s: str):
    if len(s) > MAX_LEN:
        raise HTTPException(400, "expression too long")
    if not ALLOWED.match(s):
        raise HTTPException(400, "expression contains disallowed characters")
    normalized = s.replace("^", "**")
    # Reject towers/huge powers before SymPy evaluates them.
    for exp in re.findall(r"\*\*\s*\(?\s*(\d+)", normalized):
        if len(exp) > MAX_EXPONENT_DIGITS:
            raise HTTPException(400, "exponent too large")
    if normalized.count("**") > 4:
        raise HTTPException(400, "too many exponentiations")
    try:
        return parse_expr(normalized, transformations=TRANSFORMS, evaluate=True)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "could not parse expression")


class SolveCheck(BaseModel):
    equation: str = Field(max_length=MAX_LEN)  # e.g. "2*x + 3 = 11"
    variable: str = Field(max_length=8, pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$")
    student_answer: str = Field(max_length=MAX_LEN)


class CompareCheck(BaseModel):
    left: str = Field(max_length=MAX_LEN)
    right: str = Field(max_length=MAX_LEN)
    student_says: str = Field(pattern=r"^[<>=]$")


class EquivCheck(BaseModel):
    expression: str = Field(max_length=MAX_LEN)
    student_expression: str = Field(max_length=MAX_LEN)
    # Simplify/expand tasks ask for a bracket-free form; without this rule a
    # student could type the question back and be "equivalent".
    no_parentheses: bool = False


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/check/solve")
def check_solve(body: SolveCheck):
    if body.equation.count("=") != 1:
        raise HTTPException(400, "equation must contain exactly one '='")
    var = symbols(body.variable)
    lhs, rhs = body.equation.split("=")
    eq = Eq(parse(lhs), parse(rhs))
    answer = parse(body.student_answer)
    try:
        correct = bool(simplify(eq.lhs.subs(var, answer) - eq.rhs.subs(var, answer)) == 0)
    except Exception:
        raise HTTPException(400, "could not evaluate equation with that answer")
    return {"correct": correct}


@app.post("/check/compare")
def check_compare(body: CompareCheck):
    try:
        l, r = Rational(body.left), Rational(body.right)
    except Exception:
        raise HTTPException(400, "left/right must be numeric")
    actual = "<" if l < r else ">" if l > r else "="
    return {"correct": actual == body.student_says, "actual": actual}


@app.post("/check/equivalent")
def check_equivalent(body: EquivCheck):
    if body.no_parentheses and "(" in body.student_expression:
        return {"correct": False, "reason": "answer must be written without brackets"}
    try:
        diff = simplify(parse(body.expression) - parse(body.student_expression))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "could not compare expressions")
    return {"correct": diff == 0}
