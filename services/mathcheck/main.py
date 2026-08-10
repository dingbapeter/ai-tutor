"""Deterministic math verification behind the LLM.

The tutor model NEVER gets final say on numeric correctness — every checkable
answer runs through SymPy here. This is what lets a small self-hosted model
teach math reliably.

Run: uvicorn main:app --port 8090
"""
from fastapi import FastAPI
from pydantic import BaseModel
from sympy import Eq, Rational, simplify, symbols
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

app = FastAPI(title="mathcheck")

TRANSFORMS = standard_transformations + (implicit_multiplication_application,)


def parse(s: str):
    return parse_expr(s.replace("^", "**"), transformations=TRANSFORMS)


class SolveCheck(BaseModel):
    equation: str  # e.g. "2*x + 3 = 11"
    variable: str  # e.g. "x"
    student_answer: str  # e.g. "4"


class CompareCheck(BaseModel):
    left: str
    right: str
    student_says: str  # "<", ">", "="


class EquivCheck(BaseModel):
    expression: str  # canonical, e.g. "(x+1)**2"
    student_expression: str  # e.g. "x**2 + 2*x + 1"


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/check/solve")
def check_solve(body: SolveCheck):
    var = symbols(body.variable)
    lhs, rhs = body.equation.split("=")
    eq = Eq(parse(lhs), parse(rhs))
    answer = parse(body.student_answer)
    correct = bool(simplify(eq.lhs.subs(var, answer) - eq.rhs.subs(var, answer)) == 0)
    return {"correct": correct}


@app.post("/check/compare")
def check_compare(body: CompareCheck):
    l, r = Rational(body.left), Rational(body.right)
    actual = "<" if l < r else ">" if l > r else "="
    return {"correct": actual == body.student_says, "actual": actual}


@app.post("/check/equivalent")
def check_equivalent(body: EquivCheck):
    diff = simplify(parse(body.expression) - parse(body.student_expression))
    return {"correct": diff == 0}
