import sys
import os

# Add python-backend to sys.path so we can import from it
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../python-backend'))
sys.path.append(backend_dir)

from main import app
