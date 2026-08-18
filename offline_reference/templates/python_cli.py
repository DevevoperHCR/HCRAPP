#!/usr/bin/env python3
"""Small argparse CLI starter."""
import argparse
p=argparse.ArgumentParser(description="DeveloperHCR CLI starter")
p.add_argument("--name",default="DeveloperHCR")
args=p.parse_args()
print(f"Hello, {args.name}!")
