"""Safe, deterministic Python game engines exposed through authenticated APIs."""
import random

def guess_number(guess: int, secret: int = None):
    secret = secret if secret is not None else random.randint(1, 20)
    if guess < secret: result = "Higher"
    elif guess > secret: result = "Lower"
    else: result = "Correct"
    return {"secret": secret if result == "Correct" else None, "result": result}

def dice(count=2):
    count=max(1,min(int(count),6))
    rolls=[random.randint(1,6) for _ in range(count)]
    return {"rolls":rolls,"total":sum(rolls)}
