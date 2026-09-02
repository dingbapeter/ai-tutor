"""Run: pytest test_main.py"""
from fastapi.testclient import TestClient
from main import app

c = TestClient(app)


def test_solve_correct_and_incorrect():
    ok = c.post("/check/solve", json={"equation": "2*x + 3 = 11", "variable": "x", "student_answer": "4"})
    assert ok.json() == {"correct": True}
    bad = c.post("/check/solve", json={"equation": "2*x + 3 = 11", "variable": "x", "student_answer": "7"})
    assert bad.json() == {"correct": False}


def test_solve_accepts_fractions_and_caret_powers():
    r = c.post("/check/solve", json={"equation": "2*x = 1", "variable": "x", "student_answer": "1/2"})
    assert r.json() == {"correct": True}
    r = c.post("/check/solve", json={"equation": "x^2 = 9", "variable": "x", "student_answer": "3"})
    assert r.json() == {"correct": True}


def test_compare():
    r = c.post("/check/compare", json={"left": "0.25", "right": "0.5", "student_says": "<"})
    assert r.json()["correct"] is True


def test_equivalent():
    r = c.post("/check/equivalent", json={"expression": "(x+1)^2", "student_expression": "x^2 + 2*x + 1"})
    assert r.json()["correct"] is True


def test_equivalent_no_parentheses_blocks_typing_the_question_back():
    # Expand tasks demand a bracket-free answer: the prompt itself must not score.
    r = c.post("/check/equivalent", json={"expression": "4*(x + 3)", "student_expression": "4(x+3)", "no_parentheses": True})
    assert r.json()["correct"] is False
    r = c.post("/check/equivalent", json={"expression": "4*(x + 3)", "student_expression": "4x + 12", "no_parentheses": True})
    assert r.json()["correct"] is True
    # Without the flag, equivalence alone decides (backwards compatible).
    r = c.post("/check/equivalent", json={"expression": "4*(x + 3)", "student_expression": "4(x+3)"})
    assert r.json()["correct"] is True


def test_rejects_exponent_bombs():
    r = c.post("/check/solve", json={"equation": "x = 1", "variable": "x", "student_answer": "9**99999"})
    assert r.status_code == 400
    r = c.post("/check/equivalent", json={"expression": "x", "student_expression": "9**9**9**9**9**9"})
    assert r.status_code == 400


def test_rejects_disallowed_characters_and_garbage():
    r = c.post("/check/solve", json={"equation": "x = 1", "variable": "x", "student_answer": "__import__"})
    assert r.status_code == 400
    r = c.post("/check/solve", json={"equation": "2*x + = 11", "variable": "x", "student_answer": "4"})
    assert r.status_code == 400
    r = c.post("/check/compare", json={"left": "abc", "right": "0.5", "student_says": "<"})
    assert r.status_code == 400


def test_rejects_multiple_equals():
    r = c.post("/check/solve", json={"equation": "x = 1 = 2", "variable": "x", "student_answer": "1"})
    assert r.status_code == 400
